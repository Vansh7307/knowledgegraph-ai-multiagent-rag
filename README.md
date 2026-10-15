# KnowledgeGraph AI — Multi-Agent RAG System

> **Research Motivation:** Standard LLMs suffer from severe hallucination when analyzing hundreds of connected documents because they treat every query as an isolated lookup. This project implements **GraphRAG** — a retrieval architecture that builds a persistent knowledge graph from documents and traverses it at query time — eliminating the disconnected-context failure mode.

---

## Research Methodology

This system is grounded in the Microsoft Research paper:

> Edge, D., Trinh, H., Cheng, N., Bradley, J., Chao, A., Mody, A., Truitt, S., & Larson, J. (2024).  
> **From Local to Global: A Graph RAG Approach to Query-Focused Summarization.**  
> *arXiv:2404.16130*

The key insight: by pre-computing a knowledge graph of entities and relationships, the system can answer **multi-hop relational queries** (e.g., *"Which organization developed the model that GPT's decoder architecture descended from?"*) that defeat standard vector-similarity RAG.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     React / Next.js Frontend                    │
│  ┌──────────────┐  ┌──────────────────────┐  ┌──────────────┐  │
│  │  Ingestion   │  │   Graph Visualization │  │    Chat      │  │
│  │  Panel       │  │  (react-force-graph)  │  │    Panel     │  │
│  │  drag & drop │  │   live nodes/edges    │  │  Q&A + meta  │  │
│  └──────┬───────┘  └──────────┬────────────┘  └──────┬───────┘  │
└─────────┼────────────────────┼───────────────────────┼──────────┘
          │ POST /ingest        │ GET /graph-data        │ POST /query
          ▼                     ▼                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FastAPI Backend (app.py)                    │
│                                                                 │
│  ┌─────────────────┐   ┌──────────────────┐  ┌──────────────┐  │
│  │ Extractor Agent │   │  Router Agent    │  │ Synthesizer  │  │
│  │ (agents.py)     │   │  (agents.py)     │  │ Agent        │  │
│  │ PDF→JSON        │   │  graph|text|     │  │ (agents.py)  │  │
│  │ entities+rels   │   │  hybrid routing  │  │ cited answer │  │
│  └────────┬────────┘   └──────────────────┘  └──────┬───────┘  │
│           │                                          │          │
│  ┌────────▼────────────────────────────────────────▼────────┐  │
│  │              LangGraph Orchestrator (graph_orchestrator)  │  │
│  │   Retrieve → Reason (hop check) → Synthesize             │  │
│  └────────┬──────────────────────────────────────────────────┘  │
└───────────┼─────────────────────────────────────────────────────┘
            │
     ┌──────┴──────────────────────┐
     │                             │
     ▼                             ▼
┌──────────────┐          ┌─────────────────┐
│  NetworkX    │          │  Neo4j AuraDB   │
│  (in-memory) │          │  (cloud, Cypher │
│  fast lookup │          │   MERGE writes) │
└──────────────┘          └─────────────────┘
```

---

## Three Distinct AI Agents

| Agent | Role | Output |
|---|---|---|
| **Extractor Agent** | Reads each document chunk, outputs structured JSON of entities (typed: Person, Org, Technology…) and relationships | `{entities, relations}` → Neo4j + NetworkX |
| **Router Agent** | Classifies each user query as `graph`, `text`, or `hybrid` retrieval | Routing decision with reason |
| **Synthesizer Agent** | Takes raw graph facts + retrieved chunks, writes a cited human-readable answer | Final answer with `[chunk_id]` citations |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (TypeScript) |
| Graph Visualization | `react-force-graph` — interactive, draggable nodes/edges |
| Backend | FastAPI + LangGraph |
| Graph DB (cloud) | Neo4j AuraDB (free tier) |
| Graph DB (in-memory) | NetworkX |
| PDF Parsing | PyMuPDF (`fitz`) |
| Semantic Chunking | LangChain `RecursiveCharacterTextSplitter` |
| LLM | Groq / Gemini / Ollama / OpenAI (auto-selected) |

---

## Quick Start

### 1. Backend

```bash
cd kg_project
pip install -r requirements.txt
cp .env.example .env
# Fill in GROQ_API_KEY (or any LLM key) and optionally NEO4J_URI
uvicorn src.app:app --reload --port 8000
```

### 2. Frontend

```bash
cd kg_project/frontend
npm install
npm run dev
# Open http://localhost:3000
```

### 3. Neo4j AuraDB (optional but recommended)

1. Create a free instance at https://neo4j.com/cloud/aura-free/
2. Copy the connection URI, username, and password into `.env`:
   ```
   NEO4J_URI=neo4j+s://<your-instance>.databases.neo4j.io
   NEO4J_USERNAME=neo4j
   NEO4J_PASSWORD=<your-password>
   ```
3. Restart the backend — entities and relationships will now persist to the cloud graph.

---

## Live Demo Narrative

**Hook:** *"Standard LLMs hallucinate when asked to reason across hundreds of connected documents — they have no memory of how entities relate to each other."*

**The Build:** Upload a complex PDF (research paper, business report). Watch the **Knowledge Graph panel** dynamically draw nodes and edges in real-time as the Extractor Agent processes each chunk.

**The Proof:** Ask a multi-hop question: *"Which organization developed the architecture that GPT's decoder is based on?"* — the Router Agent selects graph traversal, the graph is traversed 2 hops, and the Synthesizer Agent returns a cited answer that traces back to the exact source chunk.

**The Contrast:** Ask the same question to a standard chatbot with no graph — it either hallucinates or refuses.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Liveness check + graph stats |
| `POST` | `/query` | `{question}` → answer + agent metadata |
| `POST` | `/ingest` | Multipart file upload → graph update |
| `GET` | `/graph-data` | Current graph as `{nodes, links}` JSON |
| `GET` | `/graph-stream` | SSE stream of graph build events |

---

## License

MIT
