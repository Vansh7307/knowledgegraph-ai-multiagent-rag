# KnowledgeGraph AI -- Multi-Agent RAG System

[![Tests](https://github.com/Vansh7307/knowledgegraph-ai-multiagent-rag/actions/workflows/tests.yml/badge.svg)](https://github.com/Vansh7307/knowledgegraph-ai-multiagent-rag/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A **Graph RAG** system built from five cooperating agents, orchestrated with
**LangGraph**. It answers questions by combining lexical retrieval, a
knowledge graph built from your documents, and a bounded multi-hop
reasoning loop -- so it can answer questions that require connecting facts
across more than one document.

Built in the tutorial style of, and referencing conventions from,
[NirDiamant/GenAI_Agents](https://github.com/NirDiamant/GenAI_Agents).

## Architecture

```
                 ┌─────────────────────┐
   documents --> │  Ingestion Agent    │   chunk + load
                 └─────────┬───────────┘
                           │
                 ┌─────────▼───────────┐
                 │ Graph Builder Agent │   entities + relations -> NetworkX KG
                 └─────────┬───────────┘
                           │  (built once, reused for every query)
      ┌────────────────────┼────────────────────┐
      │                    ▼                     │
      │   ┌─────────────────────────┐            │
      │   │    Retrieval Agent      │◄───────┐   │   LangGraph
      │   │  BM25 + graph traversal │        │   │   query-time
      │   └───────────┬─────────────┘        │   │   state machine
      │               ▼                      │   │
      │   ┌─────────────────────────┐    another hop
      │   │    Reasoning Agent      │────────┘   │
      │   │  sufficient? loop?      │             │
      │   └───────────┬─────────────┘             │
      │               ▼ sufficient                │
      │   ┌─────────────────────────┐             │
      │   │    Synthesis Agent      │             │
      │   │  cited final answer     │             │
      │   └─────────────────────────┘             │
      └────────────────────────────────────────────┘
```

| Agent | File | Responsibility |
|---|---|---|
| Ingestion | `src/text_utils.py` | loads `.txt` docs, sliding-window chunking with stable chunk IDs for citations |
| Graph Builder | `src/knowledge_graph.py` | extracts entities/relations per chunk, merges into a `networkx.MultiDiGraph` with full provenance |
| Retrieval | `src/retriever.py` | BM25 lexical search over chunks + entity matching for graph traversal |
| Reasoning | `src/agents.py::ReasoningAgent` | judges if context is sufficient; if not, requests another hop (bounded) |
| Synthesis | `src/agents.py::SynthesisAgent` | writes the final answer, citing chunk IDs |
| Orchestrator | `src/graph_orchestrator.py` | wires the above into a LangGraph `StateGraph` with a conditional retrieve<->reason loop |

## Runs for free, no API key required

The LLM layer (`src/llm_provider.py`) auto-selects the best available option,
free options first:

1. **Groq** free tier (fast Llama models) -- set `GROQ_API_KEY`
2. **Google Gemini** free tier -- set `GOOGLE_API_KEY`
3. **Ollama**, fully local and free -- just run it, no key needed
4. **OpenAI** -- paid, used only if you set `OPENAI_API_KEY` and nothing free is configured
5. **Offline rule-based fallback** -- if none of the above are configured, the
   system still runs end-to-end using regex-based entity extraction and
   extractive answering. Zero cost, zero network calls, useful for grading,
   CI, and demos.

Copy `.env.example` to `.env` and fill in one key to upgrade from offline
mode to full LLM reasoning. Groq's and Gemini's free tiers, and Ollama, cost
nothing.

## Quick start

```bash
pip install -r requirements.txt
cp .env.example .env        # optional: add a free-tier key
python -m src.main           # runs a small built-in demo Q&A set
python -m src.main "How does Graph RAG differ from plain RAG?"
```

Or open `notebooks/KnowledgeGraph_AI_MultiAgent_RAG.ipynb` for the same
pipeline with an inline knowledge-graph visualization and step-by-step
explanations.

## Using your own documents

Drop any `.txt` files into `data/sample_docs/` (or point `KG_DATA_DIR` at
another folder) and rerun -- the graph is rebuilt from whatever is in that
directory.

## Graph caching

Building the graph calls the LLM once per chunk, which costs time and (on
free-tier providers) quota. The built graph is cached to disk at
`.cache/knowledge_graph.json`, keyed on a hash of the corpus -- so restarting
the process (including Render's free-tier sleep/wake cycle) reloads the
cached graph instantly instead of re-extracting every chunk. The cache
invalidates itself automatically the moment a source document changes.
Delete the `.cache/` folder to force a full rebuild.

## Known limitations

This is a demo-scale reference implementation, not a hardened production
service. Specifically:

- **No authentication or rate limiting on the API.** Anyone with the URL can
  call `/query`. Fine for a demo/portfolio deployment; add an API key check
  or a reverse-proxy rate limiter before exposing it more broadly.
- **BM25, not semantic embeddings, for lexical retrieval.** Keeps the stack
  free and dependency-light, but won't catch paraphrases that share no
  keywords with the question. Swapping in a sentence-transformers or
  OpenAI-embeddings retriever is a drop-in replacement for `HybridRetriever`.
- **NetworkX, not a graph database.** Fine for a few thousand nodes in
  memory; a corpus with millions of entities would want Neo4j or similar.
- **The offline rule-based fallback is intentionally simple** (regex entity
  extraction, extractive answers). It exists to keep the system runnable
  with zero cost/config, not to match a real LLM's quality -- configure a
  free-tier key (Groq/Gemini) or Ollama for real reasoning.
- **Render's free tier sleeps after inactivity**, so the first request after
  idling takes 30-50 seconds to wake up (graph caching means it won't
  re-extract entities, but the process itself still needs to cold-start).

## Tests

```bash
python -m pytest tests/ -v
```

All tests run offline against the rule-based fallback, so they're
deterministic and require no API key.

## Design notes

- **Why a knowledge graph, not just vector search?** Vector similarity
  finds passages that sound like the question, but misses facts only
  reachable through an intermediate entity. Traversing the graph a couple
  of hops out from matched entities recovers those multi-hop connections.
- **Why LangGraph?** The Reasoning agent needs to conditionally send
  control back to Retrieval for another hop. `StateGraph` + conditional
  edges express that control flow declaratively, with the hop limit and
  state made explicit and testable, instead of a hand-rolled `while` loop.
- **Why one OpenAI-compatible client for four providers?** Groq, Gemini,
  Ollama, and OpenAI all expose an OpenAI-compatible `/chat/completions`
  endpoint, so a single client with a different `base_url` handles all of
  them -- no per-provider SDK sprawl, and adding a fifth provider is a
  one-line change.
- **Every edge has provenance.** Each relation stored in the graph keeps
  the source chunk ID and document it came from, so every answer's
  citations are traceable back to the original text.

## Project layout

```
.
├── README.md
├── requirements.txt
├── .env.example
├── data/sample_docs/          # demo corpus on LLM/RAG history
├── notebooks/
│   └── KnowledgeGraph_AI_MultiAgent_RAG.ipynb
├── src/
│   ├── config.py               # env-driven settings
│   ├── llm_provider.py         # provider-agnostic LLM client + offline fallback
│   ├── text_utils.py           # loading + chunking
│   ├── knowledge_graph.py      # Graph Builder Agent
│   ├── retriever.py            # Retrieval Agent
│   ├── agents.py               # Reasoning + Synthesis Agents
│   ├── graph_orchestrator.py   # LangGraph wiring
│   └── main.py                 # CLI entry point
└── tests/
    └── test_basic.py
```
