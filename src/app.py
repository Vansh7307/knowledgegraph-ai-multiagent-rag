"""Standalone FastAPI adapter for the local, deterministic GraphRAG engine."""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src.config import settings
from src.scratch_engine import Chunk, GraphRAGEngine, chunk_text

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger("local-graphrag")
pipeline_state: dict = {}
_request_log: dict[str, deque[float]] = {}
DATA_DIR = Path(os.getenv("KG_DATA_DIR", str(Path(__file__).parent.parent / "data" / "sample_docs")))


def _load_corpus(engine: GraphRAGEngine, directory: Path) -> None:
    if directory.exists():
        for path in sorted(directory.iterdir()):
            if path.suffix.lower() == ".txt":
                text = path.read_text(encoding="utf-8")
                engine.ingest(chunk_text(text, path.name, settings.chunk_size_words, settings.chunk_overlap_words))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    engine = GraphRAGEngine()
    _load_corpus(engine, DATA_DIR)
    pipeline_state["engine"] = engine
    logger.info("Local GraphRAG ready: %d nodes, %d edges", len(engine.graph.nodes), len(engine.graph.edges))
    yield
    pipeline_state.clear()


app = FastAPI(title="KnowledgeGraph AI - Offline Multi-Agent GraphRAG", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=500)


class ChunkRequest(BaseModel):
    chunk_id: str
    source: str
    text: str


class SyncRequest(BaseModel):
    chunks: list[ChunkRequest]


def _engine() -> GraphRAGEngine:
    engine = pipeline_state.get("engine")
    if engine is None:
        raise HTTPException(status_code=503, detail="Local graph is initializing.")
    return engine


def _graph() -> dict:
    return _engine().graph_payload()


def _health() -> dict:
    graph = _engine().graph
    return {"status": "ok", "llm_provider": "local deterministic engine",
            "graph_nodes": len(graph.nodes), "graph_edges": len(graph.edges)}


def _check_query_access(request: Request, x_api_key: str | None) -> None:
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Missing or invalid X-API-Key header.")
    client = request.client.host if request.client else "unknown"
    now = time.monotonic()
    times = _request_log.setdefault(client, deque())
    while times and now - times[0] >= 60:
        times.popleft()
    if len(times) >= settings.rate_limit_per_minute:
        raise HTTPException(status_code=429, detail=f"Rate limit exceeded ({settings.rate_limit_per_minute} req/min).")
    times.append(now)


@app.get("/health")
def health():
    return _health()


@app.get("/api/health")
def api_health():
    return _health()


@app.get("/api/graph")
@app.get("/api/graph-data")
@app.get("/graph-data")
def graph_data():
    payload = _graph()
    graph = _engine().graph
    return {**payload, "node_count": len(graph.nodes), "edge_count": len(graph.edges),
            "chunk_count": len(_engine().chunks), "llm_provider": "local deterministic engine"}


@app.post("/api/query-rich")
def api_query_rich(request: QueryRequest, http_request: Request,
                   x_api_key: str | None = Header(default=None)):
    _check_query_access(http_request, x_api_key)
    return _engine().query(request.question)


@app.post("/api/query")
@app.post("/query")
def query(request: QueryRequest, http_request: Request,
          x_api_key: str | None = Header(default=None)):
    _check_query_access(http_request, x_api_key)
    result = _engine().query(request.question)
    return {key: result[key] for key in
            ("answer", "hops", "chunks_used", "graph_facts_used", "strategy", "confidence")}


async def _read_upload(file: UploadFile) -> str:
    filename = file.filename or "upload.txt"
    if Path(filename).suffix.lower() not in {".txt", ".pdf"}:
        raise HTTPException(status_code=400, detail="Only .txt and .pdf files are supported.")
    contents = await file.read(10 * 1024 * 1024 + 1)
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large. Maximum upload size is 10 MB.")
    if Path(filename).suffix.lower() == ".pdf":
        try:
            import fitz
            document = fitz.open(stream=contents, filetype="pdf")
            text = "\n".join(page.get_text() for page in document)
        except (ImportError, RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="The PDF could not be read.") from exc
    else:
        text = contents.decode("utf-8", errors="replace")
    if not text.strip():
        raise HTTPException(status_code=400, detail="The uploaded file contains no readable text.")
    return text


@app.post("/api/upload")
@app.post("/api/ingest")
async def upload(file: UploadFile = File(...)):
    filename = file.filename or "upload.txt"
    text = await _read_upload(file)
    engine = _engine()
    chunks = chunk_text(text, filename, settings.chunk_size_words, settings.chunk_overlap_words)
    engine.ingest(chunks)
    payload = _graph()
    return {"message": f"Ingested {filename}: {len(chunks)} chunks, {len(payload['nodes'])} nodes, {len(payload['links'])} edges.",
            "graph": payload}


@app.post("/api/reset")
def reset():
    engine = _engine()
    engine.reset()
    return {"status": "reset", "node_count": 0, "edge_count": 0}


@app.post("/api/sync")
def sync_browser_graph(request: SyncRequest):
    total_bytes = sum(len(chunk.text.encode("utf-8")) for chunk in request.chunks)
    if total_bytes > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Sync payload exceeds the 10 MB limit.")
    engine = _engine()
    engine.ingest([Chunk(item.chunk_id, item.source, item.text) for item in request.chunks])
    graph = engine.graph
    return {"status": "synced", "chunks": len(engine.chunks),
            "graph_nodes": len(graph.nodes), "graph_edges": len(graph.edges)}


@app.get("/api/node-detail")
def node_detail(name: str):
    engine = _engine()
    graph = engine.graph
    if name not in graph.nodes:
        raise HTTPException(status_code=404, detail=f"Node '{name}' not found.")
    related = graph.incoming[name] + graph.outgoing[name]
    chunk_ids = graph.nodes[name].mentions
    rank = graph.pagerank().get(name, 0)
    return {
        "name": name, "type": graph.nodes[name].entity_type, "degree": graph.degree(name),
        "in_degree": len(graph.incoming[name]), "out_degree": len(graph.outgoing[name]),
        "pagerank": round(rank, 6),
        "triplets": [{"subject": edge.source, "predicate": edge.relation, "object": edge.target,
                      "chunk_id": edge.chunk_id} for edge in related],
        "source_chunks": [{"id": chunk.chunk_id, "source": chunk.source, "text": chunk.text}
                          for chunk in engine.chunks if chunk.chunk_id in chunk_ids][:5],
    }


@app.get("/api/search-nodes")
def search_nodes(q: str = ""):
    graph = _engine().graph
    matches = [name for name in graph.nodes if q.lower() in name.lower()]
    matches.sort(key=lambda name: graph.degree(name), reverse=True)
    return {"results": [{"name": name, "degree": graph.degree(name)} for name in matches[:20]]}


@app.get("/api/stats")
def stats():
    engine = _engine()
    graph = engine.graph
    top = sorted(graph.nodes, key=lambda name: graph.degree(name), reverse=True)[:10]
    return {"node_count": len(graph.nodes), "edge_count": len(graph.edges),
            "chunk_count": len(engine.chunks), "density": round(len(graph.edges) / max(1, len(graph.nodes) ** 2), 4),
            "components": len({tuple(sorted(group)) for group in _weak_components(graph)}),
            "llm_provider": "local deterministic engine",
            "top_nodes": [{"name": name, "degree": graph.degree(name)} for name in top]}


def _weak_components(graph) -> list[set[str]]:
    unseen = set(graph.nodes)
    groups = []
    while unseen:
        start = unseen.pop()
        group = {start}
        queue = [start]
        while queue:
            node = queue.pop()
            for edge in graph.outgoing[node] + graph.incoming[node]:
                neighbor = edge.target if edge.source == node else edge.source
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    group.add(neighbor)
                    queue.append(neighbor)
        groups.append(group)
    return groups


@app.get("/api/export")
def export_graph(fmt: str = "json"):
    payload = _graph()
    if fmt == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["source", "target", "relation", "chunk_id"])
        for link in payload["links"]:
            writer.writerow([link["source"], link["target"], link["relation"], link["chunk_id"]])
        return Response(buffer.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": "attachment; filename=knowledge_graph.csv"})
    return Response(json.dumps(payload, indent=2), media_type="application/json",
                    headers={"Content-Disposition": "attachment; filename=knowledge_graph.json"})


@app.get("/api/ingest-demo")
async def ingest_demo():
    """Stream local demo ingestion progress as server-sent events."""
    engine = _engine()
    demo_chunks = []
    if DATA_DIR.exists():
        for path in sorted(DATA_DIR.iterdir()):
            if path.suffix.lower() == ".txt":
                text = path.read_text(encoding="utf-8")
                demo_chunks.extend(chunk_text(
                    text, path.name, settings.chunk_size_words, settings.chunk_overlap_words))

    async def events():
        total = len(demo_chunks)
        if not total:
            yield f"event: error\ndata: {json.dumps({'message': 'No local demo text files were found.'})}\n\n"
            return
        for index, chunk in enumerate(demo_chunks, start=1):
            engine.ingest([chunk])
            payload = {
                "completed": index,
                "total": total,
                "progress": round(index / total * 100),
                "chunk_id": chunk.chunk_id,
                "node_count": len(engine.graph.nodes),
                "edge_count": len(engine.graph.edges),
            }
            yield f"event: progress\ndata: {json.dumps(payload)}\n\n"
        result = {
            "total_chunks": len(engine.chunks),
            "total_nodes": len(engine.graph.nodes),
            "total_edges": len(engine.graph.edges),
            "graph": engine.graph_payload(),
        }
        yield f"event: done\ndata: {json.dumps(result)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


FRONTEND_OUT = Path(__file__).parent.parent / "frontend" / "out"
if (FRONTEND_OUT / "_next").is_dir():
    app.mount("/_next", StaticFiles(directory=FRONTEND_OUT / "_next"), name="frontend-assets")


@app.get("/favicon.svg", include_in_schema=False)
def favicon():
    icon = FRONTEND_OUT / "favicon.svg"
    if not icon.is_file():
        raise HTTPException(status_code=404, detail="Frontend icon has not been built.")
    return FileResponse(icon, media_type="image/svg+xml")


@app.get("/", response_class=HTMLResponse)
def index():
    index_file = FRONTEND_OUT / "index.html"
    if index_file.exists():
        html = index_file.read_text(encoding="utf-8")
        head, body, tail = html.partition("<body")
        if body:
            html = f'{head}<body data-local-api="available"{tail}'
        return HTMLResponse(html)
    return HTMLResponse(
        '<html><body data-local-api="available"><h2>KnowledgeGraph AI local engine is ready.</h2></body></html>')
