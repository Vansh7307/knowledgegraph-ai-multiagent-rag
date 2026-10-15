"""
app.py
------
FastAPI backend for KnowledgeGraph AI Multi-Agent RAG System.

Endpoints:
  GET  /health          liveness + graph stats
  POST /query           {question} -> answer + metadata
  POST /ingest          multipart file upload -> triggers graph build
  GET  /graph-data      returns nodes/edges JSON for react-force-graph
  GET  /graph-stream    SSE stream of graph build events (live visualization)
"""

from __future__ import annotations

import json
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Header, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field

from src.config import settings
from src.graph_orchestrator import build_query_graph
from src.knowledge_graph import KnowledgeGraphBuilder
from src.retriever import HybridRetriever
from src.text_utils import build_all_chunks, extract_upload_text, chunk_text

# Max pages to process from an uploaded PDF (prevents LLM rate-limit exhaustion
# on large documents during a live demo). ~3 pages ≈ safe for any free-tier TPM.
_PDF_PAGE_LIMIT = 5


def _limit_pdf_pages(contents: bytes, filename: str) -> bytes:
    """Return a bytes object containing at most _PDF_PAGE_LIMIT pages."""
    if not filename.endswith(".pdf"):
        return contents
    try:
        import fitz
        doc = fitz.open(stream=contents, filetype="pdf")
        if len(doc) <= _PDF_PAGE_LIMIT:
            return contents
        writer = fitz.open()
        writer.insert_pdf(doc, from_page=0, to_page=_PDF_PAGE_LIMIT - 1)
        return writer.tobytes()
    except Exception:
        return contents


logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger("app")

pipeline_state: dict = {}
_request_log: dict[str, deque] = defaultdict(deque)


def _check_rate_limit(client_ip: str) -> None:
    now = time.monotonic()
    window = _request_log[client_ip]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= settings.rate_limit_per_minute:
        raise HTTPException(status_code=429, detail=f"Rate limit exceeded ({settings.rate_limit_per_minute} req/min).")
    window.append(now)


def _check_api_key(x_api_key: str | None) -> None:
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Missing or invalid X-API-Key header.")


def _graph_to_vis(graph) -> dict:
    """Convert NetworkX graph to {nodes, links} for react-force-graph."""
    nodes = [{"id": n, "label": n} for n in graph.nodes()]
    links = [
        {"source": u, "target": v, "relation": d.get("relation", "related_to")}
        for u, v, d in graph.edges(data=True)
    ]
    return {"nodes": nodes, "links": links}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Startup: ingesting documents from %s ...", settings.data_dir)
    chunks = build_all_chunks(settings.data_dir, settings.chunk_size_words, settings.chunk_overlap_words)

    logger.info("Startup: building knowledge graph ...")
    kg_builder = KnowledgeGraphBuilder()
    graph = kg_builder.build_with_cache(chunks, settings.graph_cache_path)
    logger.info("Startup: LLM provider: %s", kg_builder.llm.info)

    retriever = HybridRetriever(chunks)
    query_graph = build_query_graph(retriever, graph, list(graph.nodes))

    pipeline_state.update({
        "query_graph": query_graph,
        "graph": graph,
        "retriever": retriever,
        "chunks": chunks,
        "provider": kg_builder.llm.info.name,
        "node_count": graph.number_of_nodes(),
        "edge_count": graph.number_of_edges(),
    })
    logger.info("Startup complete: %d nodes, %d edges", graph.number_of_nodes(), graph.number_of_edges())
    yield
    pipeline_state.clear()


app = FastAPI(title="KnowledgeGraph AI - Multi-Agent RAG System", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class QueryRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)


class QueryResponse(BaseModel):
    answer: str
    hops: int
    chunks_used: int
    graph_facts_used: int
    strategy: str = "hybrid"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
def health():
    return {
        "status": "ok" if "query_graph" in pipeline_state else "starting",
        "llm_provider": pipeline_state.get("provider"),
        "graph_nodes": pipeline_state.get("node_count"),
        "graph_edges": pipeline_state.get("edge_count"),
    }


@app.get("/graph-data")
def graph_data():
    """Return current graph as nodes/links JSON for react-force-graph."""
    graph = pipeline_state.get("graph")
    if graph is None:
        raise HTTPException(status_code=503, detail="Graph not ready.")
    return _graph_to_vis(graph)


@app.post("/ingest")
async def ingest(file: UploadFile = File(...)):
    """
    Accept a .txt or .pdf upload. PDFs are capped at _PDF_PAGE_LIMIT pages.
    All extraction is done in-memory — no temp files written to disk.
    """
    if not file.filename.endswith((".txt", ".pdf")):
        raise HTTPException(status_code=400, detail="Only .txt and .pdf files are supported.")

    contents = await file.read()
    contents = _limit_pdf_pages(contents, file.filename)
    text = extract_upload_text(file.filename, contents)

    chunks = chunk_text(text, file.filename, settings.chunk_size_words * 5, settings.chunk_overlap_words * 5)

    graph = pipeline_state.get("graph")
    if graph is None:
        raise HTTPException(status_code=503, detail="Pipeline not ready.")

    kg_builder = KnowledgeGraphBuilder()
    kg_builder.graph = graph
    for chunk in chunks:
        kg_builder.add_chunk(chunk)

    all_chunks = pipeline_state["chunks"] + chunks
    new_retriever = HybridRetriever(all_chunks)
    new_query_graph = build_query_graph(new_retriever, graph, list(graph.nodes))

    pipeline_state.update({
        "chunks": all_chunks,
        "retriever": new_retriever,
        "query_graph": new_query_graph,
        "node_count": graph.number_of_nodes(),
        "edge_count": graph.number_of_edges(),
    })

    return {
        "message": f"Ingested '{file.filename}': {len(chunks)} chunks, graph now has {graph.number_of_nodes()} nodes / {graph.number_of_edges()} edges.",
        "graph": _graph_to_vis(graph),
    }


async def _graph_sse_stream() -> AsyncGenerator[str, None]:
    """Yield SSE events for each node/edge in the current graph (for live demo)."""
    graph = pipeline_state.get("graph")
    if not graph:
        yield "data: {\"done\": true}\n\n"
        return
    for node in graph.nodes():
        yield f"data: {json.dumps({'type': 'node', 'id': node})}\n\n"
        await __import__("asyncio").sleep(0.05)
    for u, v, d in graph.edges(data=True):
        yield f"data: {json.dumps({'type': 'edge', 'source': u, 'target': v, 'relation': d.get('relation', '')})}\n\n"
        await __import__("asyncio").sleep(0.03)
    yield "data: {\"done\": true}\n\n"


@app.get("/graph-stream")
async def graph_stream():
    """SSE endpoint: streams graph nodes/edges for live visualization."""
    return StreamingResponse(_graph_sse_stream(), media_type="text/event-stream")


@app.post("/query", response_model=QueryResponse)
def query(
    request: QueryRequest,
    http_request: Request,
    x_api_key: str | None = Header(default=None),
) -> QueryResponse:
    _check_api_key(x_api_key)
    _check_rate_limit(http_request.client.host if http_request.client else "unknown")

    if "query_graph" not in pipeline_state:
        raise HTTPException(status_code=503, detail="Knowledge graph is still building. Try again shortly.")

    # RouterAgent decides strategy (informational -- pipeline always runs hybrid)
    from src.agents import RouterAgent
    router = RouterAgent()
    route = router.route(request.question)
    strategy = route.get("strategy", "hybrid")

    query_graph = pipeline_state["query_graph"]
    try:
        result = query_graph.invoke({"question": request.question, "hop": 0})
    except Exception as e:
        logger.exception("Pipeline failed")
        raise HTTPException(status_code=502, detail="LLM provider error. Try again.") from e

    return QueryResponse(
        answer=result["answer"],
        hops=result.get("hop", 0),
        chunks_used=len(result.get("chunks", [])),
        graph_facts_used=len(result.get("graph_facts", [])),
        strategy=strategy,
    )


@app.get("/", response_class=HTMLResponse)
def index():
    return "<html><body><h2>KnowledgeGraph AI API is running. Use the React frontend or POST /query.</h2></body></html>"
