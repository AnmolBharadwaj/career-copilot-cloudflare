# Career Copilot — Cloudflare AI Assignment

Career Copilot is a stateful AI-powered job application assistant built around Cloudflare primitives.

## What it demonstrates

- **LLM:** Workers AI — `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Workflow:** Cloudflare Workflows — `JobAnalysisWorkflow`
- **User input:** React chat connected to `CareerAgent` over WebSockets
- **Memory/state:** Agents SDK + Durable Object-backed persistence + structured agent state
- **RAG:** Workers AI embeddings + Cloudflare Vectorize

## Setup

Requirements: Node.js 18+, a Cloudflare account, and Wrangler authentication.

```bash
npm install
npx wrangler login
npx wrangler vectorize create career-copilot-index --dimensions=768 --metric=cosine
npm run types
npm run dev
```

Click **Seed demo knowledge**, then use the chat or paste a real job description into **Job Fit Analyzer**.

Deploy with:

```bash
npm run deploy
```

## Architecture

React UI → CareerAgent Durable Object → Workers AI + Vectorize

Job Analyzer → JobAnalysisWorkflow → retrieval → Llama 3.3 analysis → application plan

## Important

Review and test the generated code before submitting. Replace the synthetic demo knowledge with your own verified career information. Do not add secrets to the repository.

See `ASSIGNMENT.md` for the assignment mapping and `PROMPT_HISTORY.md` for the AI-assisted development history.
