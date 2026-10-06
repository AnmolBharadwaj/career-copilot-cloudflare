import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { streamText, convertToModelMessages, pruneMessages, tool, stepCountIs } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { z } from "zod";

const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CareerAgent: DurableObjectNamespace;
}

type CareerState = { targetRole:string; targetCompany:string; skills:string[]; lastAnalysisId:string|null };
type AnalysisParams = { jobDescription:string; targetRole?:string; targetCompany?:string };
type RetrievedChunk = { id:string; score?:number; text:string; source:string };

async function embed(env:Env,text:string):Promise<number[]> {
  const result=await env.AI.run(EMBEDDING_MODEL,{text:[text]}) as {data:number[][]};
  return result.data[0];
}
async function retrieve(env:Env,query:string,topK=5):Promise<RetrievedChunk[]> {
  const vector=await embed(env,query);
  const matches=await env.VECTORIZE.query(vector,{topK,returnMetadata:true});
  return (matches.matches??[]).map(match=>{
    const metadata=(match.metadata??{}) as Record<string,unknown>;
    return {id:String(match.id),score:match.score,text:String(metadata.text??""),source:String(metadata.source??"career-knowledge-base")};
  }).filter(x=>x.text);
}
function contextBlock(chunks:RetrievedChunk[]) {
  return chunks.length ? chunks.map((c,i)=>`[${i+1}] ${c.text} (source: ${c.source})`).join("\n") : "No relevant knowledge-base context was found.";
}

export class CareerAgent extends AIChatAgent<Env> {
  initialState:CareerState={targetRole:"",targetCompany:"",skills:[],lastAnalysisId:null};
  async onChatMessage() {
    const workersai=createWorkersAI({binding:this.env.AI});
    const result=streamText({
      model:workersai(CHAT_MODEL),
      system:`You are Career Copilot, an evidence-first job application assistant. Help the candidate understand roles, tailor applications and prepare interview answers. Use searchKnowledgeBase before making claims about projects, skills, experience or preferences. Never invent experience, metrics, employers, technologies or project details. If evidence is missing, say so. Keep application answers concise, natural, specific and defensible. Current state: ${JSON.stringify(this.state)}`,
      messages:pruneMessages({messages:await convertToModelMessages(this.messages),toolCalls:"before-last-2-messages"}),
      tools:{
        searchKnowledgeBase:tool({
          description:"Semantic search over the candidate career knowledge base.",
          inputSchema:z.object({query:z.string().min(3)}),
          execute:async({query})=>({matches:await retrieve(this.env,query,5)})
        }),
        saveProfile:tool({
          description:"Save durable candidate profile information.",
          inputSchema:z.object({targetRole:z.string().optional(),targetCompany:z.string().optional(),skills:z.array(z.string()).optional()}),
          execute:async({targetRole,targetCompany,skills})=>{
            this.setState({targetRole:targetRole??this.state.targetRole,targetCompany:targetCompany??this.state.targetCompany,skills:skills??this.state.skills,lastAnalysisId:this.state.lastAnalysisId});
            return {saved:true,state:this.state};
          }
        })
      },
      stopWhen:stepCountIs(5)
    });
    return result.toUIMessageStreamResponse();
  }
}

export class JobAnalysisWorkflow extends WorkflowEntrypoint<Env,AnalysisParams> {
  async run(event:WorkflowEvent<AnalysisParams>,step:WorkflowStep) {
    const params=event.payload;
    const retrieval=await step.do("retrieve-candidate-evidence",async()=>retrieve(this.env,params.jobDescription,8));
    const analysis=await step.do("analyze-fit-with-llm",async()=>{
      const ai=createWorkersAI({binding:this.env.AI});
      const result=await streamText({
        model:ai(CHAT_MODEL),
        system:"You are an expert technical recruiter. Return valid JSON with exactly: matchScore (number 0-100), strengths (string[]), gaps (string[]), keywordsToEmphasize (string[]), risks (string[]), actionPlan (string[]). Only use supplied evidence. Do not invent experience.",
        prompt:`JOB DESCRIPTION:\n${params.jobDescription}\n\nCANDIDATE EVIDENCE:\n${contextBlock(retrieval)}`
      });
      const text=await result.text;
      try { return JSON.parse(text.replace(/^\`\`\`json\s*/i,"").replace(/\`\`\`$/i,"").trim()); }
      catch { return {raw:text,parseError:true}; }
    });
    const actionPlan=await step.do("create-application-plan",async()=>{
      const ai=createWorkersAI({binding:this.env.AI});
      const result=await streamText({model:ai(CHAT_MODEL),system:"Create a concise application plan from this fit analysis. Return plain text with 4 numbered steps.",prompt:JSON.stringify(analysis)});
      return await result.text;
    });
    return {targetRole:params.targetRole??"",targetCompany:params.targetCompany??"",analysis,actionPlan,evidenceUsed:retrieval.map(c=>({id:c.id,score:c.score,source:c.source}))};
  }
}

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext) {
    const url=new URL(request.url);
    if(url.pathname==="/api/analyze"&&request.method==="POST"){
      const body=await request.json() as AnalysisParams;
      if(!body.jobDescription?.trim()) return Response.json({error:"jobDescription is required"},{status:400});
      const instance=await ctx.exports.JobAnalysisWorkflow.create({params:body});
      return Response.json({id:instance.id,status:"queued"},{status:202});
    }
    if(url.pathname.startsWith("/api/workflow/")&&request.method==="GET"){
      const id=url.pathname.split("/").pop();
      if(!id) return Response.json({error:"Missing workflow id"},{status:400});
      const instance=await ctx.exports.JobAnalysisWorkflow.get(id);
      return Response.json(await instance.status());
    }
    if(url.pathname==="/api/seed"&&request.method==="POST"){
      const knowledge=[
        {id:"profile-summary",source:"candidate-profile",text:"Software Engineer / Java Backend Developer with enterprise experience on digital content platforms and high-throughput data processing workflows. Focus areas include databases, SQL, Linux, Java backend development, Spring Boot, Hibernate, REST APIs and production troubleshooting."},
        {id:"project-rag",source:"candidate-projects",text:"Learning project around an LLM-powered document assistant using Spring Boot, Spring AI, embeddings, vector search, RAG, prompt templates and REST APIs."},
        {id:"java-stack",source:"candidate-skills",text:"Core Java, SQL, Spring Boot, Hibernate, REST APIs, distributed Linux environments, SQL optimization, automated validation checks and production root-cause analysis."},
        {id:"education",source:"candidate-education",text:"Bachelor of Technology in Computer Science and Engineering, Galgotias University, graduated in 2024."},
        {id:"ai-upskilling",source:"candidate-learning",text:"Upskilling in Java and Generative AI with focus on Spring AI, LLM applications, RAG, embeddings, vector search, prompt engineering and REST APIs."},
        {id:"application-style",source:"candidate-preferences",text:"Prefers Java Developer and Backend Developer roles. Application answers should be honest, concise, specific and defensible in an interview."}
      ];
      const embeddings=await env.AI.run(EMBEDDING_MODEL,{text:knowledge.map(x=>x.text)}) as {data:number[][]};
      await env.VECTORIZE.upsert(knowledge.map((item,i)=>({id:item.id,values:embeddings.data[i],metadata:{text:item.text,source:item.source}})));
      return Response.json({seeded:knowledge.length});
    }
    return (await routeAgentRequest(request,env))??new Response("Not found",{status:404});
  }
} satisfies ExportedHandler<Env>;
