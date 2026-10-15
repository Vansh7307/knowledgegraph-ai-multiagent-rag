# KnowledgeGraph AI — Offline Multi-Agent GraphRAG

KnowledgeGraph AI extracts a property graph from local documents, ranks evidence with an in-house TF-IDF/cosine implementation, and answers questions with deterministic graph traversal and source citations. The browser runs the complete TypeScript engine without a backend. An optional FastAPI process exposes the same local engine for integrations; neither runtime calls an AI provider or other external service.

## Start the browser app

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`, choose **Load Enterprise Demo**, or add a `.txt` / `.pdf` document. The demo, graph, retrieval, answers, and visualizer all run inside the browser. No account, API key, network connection, or backend startup is needed.

## Optional Python service

```powershell
pip install -r requirements.txt
cd frontend
npm install
npm run build
cd ..
uvicorn src.app:app --reload --port 8000
```

The service reads local `.txt` files from `data/sample_docs` at startup and provides `/api/health`, `/api/graph`, `/api/query-rich`, `/api/reset`, `/api/ingest-demo`, `/api/upload`, `/api/sync`, `/api/node-detail`, and `/api/export`. `/api/ingest-demo` streams progress as server-sent events. Its graph is held in memory. When the page is served by FastAPI, it detects the same-origin service and asynchronously mirrors ingested chunks; browser answers remain local and do not wait for the sync. PDF upload uses the locally installed PyMuPDF package; the standalone browser uses its built-in text extraction routine.

## From-scratch engine

- `src/scratch_engine.py` implements sentence splitting and overlapping word-window chunking; technical phrase, acronym, and capitalization-based entity extraction; verb-pattern relationship extraction; adjacency and reverse-adjacency lists; keyword postings; BFS neighborhoods and shortest paths; iterative PageRank; feature-scored query routing; TF-IDF vectors; cosine similarity; generated Cypher; and cited deterministic synthesis.
- `frontend/src/lib/scratchEngine.ts` mirrors those primitives for browser-only execution.
- `frontend/src/components/GraphPanel.tsx` implements its own canvas rendering and force simulation (cell-local Coulomb repulsion, Hooke springs, centering force, velocity damping), pointer/touch navigation, node inspection, filters, search, and export.
- `src/agents.py`, `src/retriever.py`, and `src/knowledge_graph.py` retain small compatibility interfaces backed by the local algorithms.

The TF-IDF implementation uses normalized term frequency and smoothed `IDF = log((1 + N) / (1 + df)) + 1`; cosine similarity is the normalized vector dot product. Relationship extraction abstains when a supported predicate and subject/object pattern are not found. Extracted relations remain heuristic, so answers label them as such and include source chunk IDs rather than claiming a formal fact-verification guarantee. When neither source chunks nor graph relationships match, the engine says so instead of inventing an answer.

## Engine parity and extraction evaluation

Run `python -m pytest tests -q` to execute shared JSON fixtures through Python and TypeScript and compare graph nodes, directed edges, PageRank, BFS results, path nodes/hops, confidence inputs, and ranked chunk IDs/scores. The parity test uses the local TypeScript compiler already installed with the frontend dependencies. Run `python tests/evaluate_extraction.py` to print precision, recall, macro/micro F1, and false-positive rates for the 100-sentence gold fixture. These fixture metrics are not a claim about arbitrary documents.

Run `python -m pytest tests/test_extraction_robustness.py -q` for the 100-sentence labeled extraction benchmark, including passive voice, coordinated predicates, negation, and pronoun abstention. It reports macro and micro precision/recall/F1 and sentence-level false-positive rate. Run `python -m src.benchmark` for a JSON report of ingestion throughput, 10,000-node BFS latency, TF-IDF scoring, and graph/text/hybrid query latency; the command exits nonzero if the measured p95 targets are missed. `npm run test:benchmark` checks TypeScript engine ingestion and query behavior.

Install the frontend development dependencies and Chromium once with `npm install` and `npx playwright install chromium`, then run `npm run test:e2e` from `frontend`. The Playwright suite starts the Next.js dev server and FastAPI backend and exercises SSE demo ingestion, mobile/desktop layouts, and settled canvas animation.

## Validation

```powershell
cd frontend
npm run build
cd ..
python -m pytest tests -q
```
