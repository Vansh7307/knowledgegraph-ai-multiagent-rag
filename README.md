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

## Validation

```powershell
cd frontend
npm run build
cd ..
python -m pytest tests -q
```
