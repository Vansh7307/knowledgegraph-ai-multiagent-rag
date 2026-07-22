"""
app.py
------
Web layer for the KnowledgeGraph AI Multi-Agent RAG System.

Builds the knowledge graph ONCE at startup (not per-request -- that's the
expensive step), keeps it in memory, and exposes:

  GET  /            a minimal chat-style UI
  GET  /health       liveness check
  POST /query        {"question": "..."} -> answer + metadata

Run locally with:   uvicorn src.app:app --reload
Deployed on Render with the same command (see render.yaml).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from src.config import settings
from src.graph_orchestrator import build_query_graph
from src.knowledge_graph import KnowledgeGraphBuilder
from src.retriever import HybridRetriever
from src.text_utils import build_all_chunks

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger("app")

# Populated once at startup, reused by every request.
pipeline_state: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Startup: ingesting documents from %s ...", settings.data_dir)
    chunks = build_all_chunks(settings.data_dir, settings.chunk_size_words, settings.chunk_overlap_words)

    logger.info("Startup: building knowledge graph (this runs once, not per-request) ...")
    kg_builder = KnowledgeGraphBuilder()
    graph = kg_builder.build(chunks)
    logger.info("Startup: LLM provider in use: %s", kg_builder.llm.info)

    retriever = HybridRetriever(chunks)
    query_graph = build_query_graph(retriever, graph, list(graph.nodes))

    pipeline_state["query_graph"] = query_graph
    pipeline_state["provider"] = kg_builder.llm.info.name
    pipeline_state["node_count"] = graph.number_of_nodes()
    pipeline_state["edge_count"] = graph.number_of_edges()
    logger.info("Startup complete: %d nodes, %d edges", graph.number_of_nodes(), graph.number_of_edges())

    yield
    pipeline_state.clear()


app = FastAPI(title="KnowledgeGraph AI - Multi-Agent RAG System", lifespan=lifespan)


class QueryRequest(BaseModel):
    question: str


class QueryResponse(BaseModel):
    answer: str
    hops: int
    chunks_used: int
    graph_facts_used: int


@app.get("/health")
def health():
    return {
        "status": "ok" if "query_graph" in pipeline_state else "starting",
        "llm_provider": pipeline_state.get("provider"),
        "graph_nodes": pipeline_state.get("node_count"),
        "graph_edges": pipeline_state.get("edge_count"),
    }


@app.post("/query", response_model=QueryResponse)
def query(request: QueryRequest) -> QueryResponse:
    query_graph = pipeline_state["query_graph"]
    result = query_graph.invoke({"question": request.question, "hop": 0})
    return QueryResponse(
        answer=result["answer"],
        hops=result.get("hop", 0),
        chunks_used=len(result.get("chunks", [])),
        graph_facts_used=len(result.get("graph_facts", [])),
    )


@app.get("/", response_class=HTMLResponse)
def index():
    return _INDEX_HTML


_INDEX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>KnowledgeGraph AI -- Multi-Agent RAG System</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; background: #fff; color: #111; }
  h1 { font-size: 1.3rem; }
  .sub { color: #666; margin-bottom: 24px; }
  textarea { width: 100%; box-sizing: border-box; padding: 10px; font-size: 1rem; border-radius: 8px; border: 1px solid #ccc; background: #fff; color: #111; }
  button { margin-top: 8px; padding: 8px 16px; font-size: 1rem; border-radius: 8px; border: none; background: #111; color: #fff; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .answer { margin-top: 20px; padding: 14px; border-radius: 8px; background: #f4f4f4; color: #111; white-space: pre-wrap; }
  .meta { margin-top: 8px; font-size: 0.85rem; color: #555; }
  .examples { margin-top: 12px; font-size: 0.85rem; }
  .examples button { background: #eee; color: #111; margin: 4px 4px 0 0; padding: 4px 10px; font-size: 0.8rem; }
</style>
</head>
<body>
  <h1>KnowledgeGraph AI -- Multi-Agent RAG System</h1>
  <div class="sub">Ask a question about the ingested documents (Transformers / GPT / RAG history demo corpus).</div>

  <textarea id="question" rows="3" placeholder="e.g. How is BERT related to the Transformer architecture Google introduced?"></textarea>
  <br/>
  <button id="ask">Ask</button>

  <div class="examples">
    Try:
    <button onclick="fillExample(this)">What is Self-Attention?</button>
    <button onclick="fillExample(this)">How does Graph RAG differ from plain RAG?</button>
    <button onclick="fillExample(this)">What company built ChatGPT?</button>
  </div>

  <div id="result"></div>

<script>
function fillExample(btn) {
  document.getElementById('question').value = btn.textContent;
}

document.getElementById('ask').addEventListener('click', async () => {
  const question = document.getElementById('question').value.trim();
  if (!question) return;
  const btn = document.getElementById('ask');
  const result = document.getElementById('result');
  btn.disabled = true;
  result.innerHTML = '<div class="answer">Thinking...</div>';
  try {
    const res = await fetch('/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    const data = await res.json();
    result.innerHTML = `<div class="answer">${data.answer}</div>
      <div class="meta">${data.hops} reasoning hop(s) · ${data.chunks_used} chunk(s) · ${data.graph_facts_used} graph fact(s) used</div>`;
  } catch (e) {
    result.innerHTML = '<div class="answer">Error: ' + e + '</div>';
  } finally {
    btn.disabled = false;
  }
});
</script>
</body>
</html>"""