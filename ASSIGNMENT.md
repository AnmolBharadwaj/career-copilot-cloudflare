# Assignment Submission Notes

## Career Copilot — AI Job Application Assistant

The application is designed to satisfy the requested Cloudflare AI assignment.

### LLM
Workers AI with Meta Llama 3.3 70B FP8 Fast:
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`

### Workflow / coordination
`JobAnalysisWorkflow` has durable steps for candidate-evidence retrieval, LLM fit analysis, and application-plan generation.

### User input
The React UI provides real-time chat through `CareerAgent` and a job-description form for workflow analysis.

### Memory / state
`CareerAgent` extends `AIChatAgent`, providing durable Agent identity/state and persisted chat history through the Durable Object.

### RAG
Candidate evidence is embedded with `@cf/baai/bge-base-en-v1.5` and stored in Cloudflare Vectorize. Queries retrieve semantic evidence before generation.

### Why an Agent?
The LLM is only one part of the system. The application combines durable identity, persistent state, callable tools, semantic retrieval, real-time communication and a multi-step durable workflow.

### Production improvements
- Authentication and per-user Vectorize namespaces
- R2-backed document ingestion and chunking
- Automated ingestion workflows
- Voice input
- Retrieval/faithfulness evaluation
- Rate limiting and observability
- Human confirmation before external job submission
