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
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from src.config import settings
from src.graph_orchestrator import build_query_graph
from src.knowledge_graph import KnowledgeGraphBuilder
from src.retriever import HybridRetriever
from src.text_utils import build_all_chunks

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger("app")

# Populated once at startup, reused by every request.
pipeline_state: dict = {}

# Per-IP sliding-window rate limiting, in-memory (fine for a single-instance
# free-tier deployment; swap for Redis/slowapi if you scale to multiple
# instances). Deliberately generous by default (see KG_RATE_LIMIT_PER_MINUTE)
# -- this exists to stop runaway/abusive usage from exhausting a free LLM
# quota, not to throttle normal use.
_request_log: dict[str, deque] = defaultdict(deque)


def _check_rate_limit(client_ip: str) -> None:
    now = time.monotonic()
    window = _request_log[client_ip]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= settings.rate_limit_per_minute:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded ({settings.rate_limit_per_minute} requests/minute). Try again shortly.",
        )
    window.append(now)


def _check_api_key(x_api_key: str | None) -> None:
    """No-op if API_KEY is unset (the default) -- opt-in, not required."""
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Missing or invalid X-API-Key header.")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Startup: ingesting documents from %s ...", settings.data_dir)
    chunks = build_all_chunks(settings.data_dir, settings.chunk_size_words, settings.chunk_overlap_words)

    logger.info("Startup: building knowledge graph (this runs once, not per-request) ...")
    kg_builder = KnowledgeGraphBuilder()
    graph = kg_builder.build_with_cache(chunks, settings.graph_cache_path)
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
    question: str = Field(..., min_length=3, max_length=500)


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
def query(request: QueryRequest, http_request: Request, x_api_key: str | None = Header(default=None)) -> QueryResponse:
    _check_api_key(x_api_key)
    _check_rate_limit(http_request.client.host if http_request.client else "unknown")

    if "query_graph" not in pipeline_state:
        raise HTTPException(status_code=503, detail="Knowledge graph is still building. Try again in a few seconds.")

    query_graph = pipeline_state["query_graph"]
    try:
        result = query_graph.invoke({"question": request.question, "hop": 0})
    except Exception as e:  # noqa: BLE001 -- deliberately broad: any LLM/provider failure should degrade gracefully
        logger.exception("Pipeline failed while answering a question")
        raise HTTPException(
            status_code=502,
            detail="The reasoning pipeline hit an error talking to the LLM provider "
                   "(rate limit or transient failure). Please try again in a moment.",
        ) from e

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
<title>KnowledgeGraph AI — Multi-Agent RAG System</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    color-scheme: dark;
    --bg: #0a0e14;
    --panel: #121822;
    --panel-2: #0d131b;
    --border: #212b38;
    --text: #e7ecf2;
    --muted: #7e8b9c;
    --teal: #35c9b3;
    --teal-dim: #1d6e63;
    --amber: #f0b429;
    --danger: #e0654f;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: 'IBM Plex Sans', -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: 'IBM Plex Mono', 'Courier New', monospace; }
  a { color: var(--teal); }

  .wrap { max-width: 880px; margin: 0 auto; padding: 56px 24px 80px; }

  .eyebrow {
    font-family: 'IBM Plex Mono', monospace; font-size: 0.72rem; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--teal); margin-bottom: 14px;
    display: flex; align-items: center; gap: 8px;
  }
  .eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 8px var(--teal); }

  h1 { font-size: clamp(1.8rem, 4vw, 2.4rem); font-weight: 700; margin: 0 0 10px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 0.98rem; line-height: 1.55; max-width: 62ch; margin: 0 0 40px; }
  .sub code { font-family: 'IBM Plex Mono', monospace; background: var(--panel); padding: 1px 6px; border-radius: 4px; font-size: 0.86em; color: var(--text); }

  /* ---- pipeline trace: the signature element ---- */
  .trace {
    display: flex; align-items: flex-start; justify-content: space-between;
    background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
    padding: 22px 18px 18px; margin-bottom: 28px; position: relative; overflow-x: auto;
  }
  .stage { flex: 1; min-width: 92px; text-align: center; position: relative; z-index: 1; }
  .stage .node {
    width: 34px; height: 34px; border-radius: 50%; margin: 0 auto 10px;
    border: 2px solid var(--border); background: var(--panel-2);
    display: flex; align-items: center; justify-content: center;
    font-family: 'IBM Plex Mono', monospace; font-size: 0.75rem; color: var(--muted);
    transition: border-color 0.25s ease, color 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
  }
  .stage .label { font-size: 0.74rem; color: var(--muted); transition: color 0.25s ease; }
  .stage .sub-label { font-size: 0.64rem; color: #4a5567; margin-top: 2px; font-family: 'IBM Plex Mono', monospace; }
  .stage.done .node { border-color: var(--teal-dim); color: var(--teal); background: #0f231f; }
  .stage.done .label { color: var(--text); }
  .stage.active .node {
    border-color: var(--teal); color: var(--teal); box-shadow: 0 0 0 4px rgba(53,201,179,0.15);
    animation: pulse 1.1s ease-in-out infinite;
  }
  .stage.active .label { color: var(--teal); }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 4px rgba(53,201,179,0.15); } 50% { box-shadow: 0 0 0 8px rgba(53,201,179,0.06); } }

  .trace-line {
    position: absolute; top: 39px; left: 62px; right: 62px; height: 2px;
    background: var(--border); z-index: 0;
  }
  .trace-line-fill {
    position: absolute; top: 39px; left: 62px; height: 2px; background: var(--teal);
    width: 0%; z-index: 0; transition: width 0.4s ease;
  }
  .loop-badge {
    position: absolute; top: 4px; left: 50%; transform: translateX(-50%);
    font-family: 'IBM Plex Mono', monospace; font-size: 0.62rem; color: var(--amber);
    background: #241d0e; border: 1px solid #4a3a15; border-radius: 20px; padding: 2px 8px;
    opacity: 0; transition: opacity 0.3s ease; white-space: nowrap;
  }
  .loop-badge.show { opacity: 1; }

  /* ---- input ---- */
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
  label.field-label { display: block; font-family: 'IBM Plex Mono', monospace; font-size: 0.72rem; color: var(--muted); letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 10px; }
  textarea#question {
    width: 100%; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); font-family: 'IBM Plex Sans', sans-serif; font-size: 0.98rem; padding: 12px 14px;
    resize: vertical; min-height: 64px; line-height: 1.5;
  }
  textarea#question:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
  textarea#question::placeholder { color: #4a5567; }

  .row { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; flex-wrap: wrap; gap: 10px; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; }
  .chip {
    font-family: 'IBM Plex Mono', monospace; font-size: 0.74rem; color: var(--muted);
    background: var(--panel-2); border: 1px solid var(--border); border-radius: 20px;
    padding: 5px 12px; cursor: pointer; transition: color 0.15s ease, border-color 0.15s ease;
  }
  .chip:hover { color: var(--teal); border-color: var(--teal-dim); }

  button#ask {
    font-family: 'IBM Plex Mono', monospace; font-size: 0.85rem; font-weight: 500;
    background: var(--teal); color: #06110f; border: none; border-radius: 8px;
    padding: 10px 20px; cursor: pointer; transition: filter 0.15s ease;
  }
  button#ask:hover:not(:disabled) { filter: brightness(1.08); }
  button#ask:disabled { background: var(--border); color: var(--muted); cursor: not-allowed; }
  button#ask:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }

  /* ---- result ---- */
  #result { margin-top: 22px; }
  .answer-panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .answer-panel .k { font-family: 'IBM Plex Mono', monospace; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; }
  .answer-text { font-size: 1rem; line-height: 1.65; white-space: pre-wrap; }
  .answer-text .cite {
    font-family: 'IBM Plex Mono', monospace; font-size: 0.78em; color: var(--amber);
    background: #241d0e; border: 1px solid #4a3a15; border-radius: 4px; padding: 1px 5px; margin: 0 2px;
  }
  .stats-bar { display: flex; gap: 18px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); flex-wrap: wrap; }
  .stat { font-family: 'IBM Plex Mono', monospace; font-size: 0.78rem; color: var(--muted); }
  .stat b { color: var(--text); font-weight: 600; }
  .empty { color: var(--muted); font-size: 0.9rem; padding: 8px 2px; }

  footer {
    margin-top: 44px; padding-top: 18px; border-top: 1px solid var(--border);
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
    font-family: 'IBM Plex Mono', monospace; font-size: 0.72rem; color: #4a5567;
  }
  footer .live { color: var(--muted); }
  footer .live b { color: var(--teal); }

  @media (max-width: 560px) {
    .trace { flex-wrap: nowrap; }
    .stage { min-width: 74px; }
    .trace-line, .trace-line-fill { left: 48px; right: 48px; top: 33px; }
  }
</style>
</head>
<body>
<div class="wrap">

  <div class="eyebrow"><span class="dot"></span> Graph RAG · 5-agent LangGraph pipeline</div>
  <h1>KnowledgeGraph AI</h1>
  <p class="sub">
    Every answer below is traced through the live pipeline: <code>Retrieval</code> pulls
    candidate passages and graph facts, <code>Reasoning</code> decides if that's enough or
    loops back for another hop, and <code>Synthesis</code> writes the final answer — cited
    back to the exact source chunk it came from.
  </p>

  <div class="trace" id="trace">
    <div class="trace-line"></div>
    <div class="trace-line-fill" id="traceFill"></div>
    <div class="loop-badge" id="loopBadge">×2 hops</div>

    <div class="stage done" data-stage="ingestion">
      <div class="node">1</div>
      <div class="label">Ingestion</div>
      <div class="sub-label">at startup</div>
    </div>
    <div class="stage done" data-stage="graph">
      <div class="node">2</div>
      <div class="label">Graph Builder</div>
      <div class="sub-label" id="graphMeta">—</div>
    </div>
    <div class="stage" data-stage="retrieval">
      <div class="node">3</div>
      <div class="label">Retrieval</div>
      <div class="sub-label">BM25 + graph</div>
    </div>
    <div class="stage" data-stage="reasoning">
      <div class="node">4</div>
      <div class="label">Reasoning</div>
      <div class="sub-label">hop check</div>
    </div>
    <div class="stage" data-stage="synthesis">
      <div class="node">5</div>
      <div class="label">Synthesis</div>
      <div class="sub-label">cited answer</div>
    </div>
  </div>

  <div class="panel">
    <label class="field-label" for="question">Ask the knowledge graph</label>
    <textarea id="question" rows="2" maxlength="500" placeholder="e.g. How is BERT related to the Transformer architecture Google introduced?"></textarea>
    <div class="row">
      <div class="chips">
        <button class="chip" type="button">What is Self-Attention?</button>
        <button class="chip" type="button">How does Graph RAG differ from plain RAG?</button>
        <button class="chip" type="button">What company built ChatGPT?</button>
      </div>
      <button id="ask">Run pipeline →</button>
    </div>
  </div>

  <div id="result"></div>

  <footer>
    <span>KnowledgeGraph AI · <a href="https://github.com/Vansh7307/knowledgegraph-ai-multiagent-rag" target="_blank" rel="noopener">source</a></span>
    <span class="live" id="liveStatus">connecting…</span>
  </footer>
</div>

<script>
const els = {
  question: document.getElementById('question'),
  ask: document.getElementById('ask'),
  result: document.getElementById('result'),
  trace: document.getElementById('trace'),
  traceFill: document.getElementById('traceFill'),
  loopBadge: document.getElementById('loopBadge'),
  graphMeta: document.getElementById('graphMeta'),
  liveStatus: document.getElementById('liveStatus'),
};

const STAGE_FILL = { retrieval: 50, reasoning: 75, synthesis: 100 };

function setStage(name, mode) {
  const el = els.trace.querySelector(`[data-stage="${name}"]`);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (mode) el.classList.add(mode);
}

function resetTrace() {
  ['retrieval', 'reasoning', 'synthesis'].forEach(s => setStage(s, null));
  els.traceFill.style.width = '0%';
  els.loopBadge.classList.remove('show');
}

function linkify(text) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/\\[([\\w\\-.]+::chunk\\d+(?:,\\s*[\\w\\-.]+::chunk\\d+)*)\\]/g, '<span class="cite">$1</span>');
}

async function loadHealth() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    if (data.status === 'ok') {
      els.liveStatus.innerHTML = `<b>●</b> live · ${data.llm_provider} · ${data.graph_nodes} nodes / ${data.graph_edges} edges`;
      els.graphMeta.textContent = `${data.graph_nodes}n / ${data.graph_edges}e`;
    } else {
      els.liveStatus.textContent = 'starting…';
      setTimeout(loadHealth, 2000);
    }
  } catch {
    els.liveStatus.textContent = 'offline';
  }
}
loadHealth();

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => { els.question.value = chip.textContent; els.question.focus(); });
});

async function runQuery() {
  const question = els.question.value.trim();
  if (!question) { els.question.focus(); return; }

  els.ask.disabled = true;
  els.ask.textContent = 'Running…';
  resetTrace();
  els.result.innerHTML = '<div class="panel"><div class="empty">Retrieving context…</div></div>';

  setStage('retrieval', 'active');
  els.traceFill.style.width = STAGE_FILL.retrieval + '%';

  const stageTimer1 = setTimeout(() => {
    setStage('retrieval', 'done');
    setStage('reasoning', 'active');
    els.traceFill.style.width = STAGE_FILL.reasoning + '%';
  }, 500);

  try {
    const res = await fetch('/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();

    if (!res.ok) {
      clearTimeout(stageTimer1);
      resetTrace();
      const message = Array.isArray(data.detail)
        ? data.detail.map(d => d.msg).join(' ')
        : (data.detail || 'Unexpected error.');
      els.result.innerHTML = `<div class="panel"><div class="empty">${message}</div></div>`;
      return;
    }

    clearTimeout(stageTimer1);
    setStage('retrieval', 'done');
    setStage('reasoning', 'done');
    if (data.hops > 1) {
      els.loopBadge.textContent = `×${data.hops} hops`;
      els.loopBadge.classList.add('show');
    }
    setStage('synthesis', 'active');
    els.traceFill.style.width = STAGE_FILL.synthesis + '%';

    setTimeout(() => {
      setStage('synthesis', 'done');
      els.result.innerHTML = `
        <div class="answer-panel">
          <div class="k">Synthesis Agent — answer</div>
          <div class="answer-text">${linkify(data.answer)}</div>
          <div class="stats-bar">
            <div class="stat"><b>${data.hops}</b> reasoning hop${data.hops === 1 ? '' : 's'}</div>
            <div class="stat"><b>${data.chunks_used}</b> chunks retrieved</div>
            <div class="stat"><b>${data.graph_facts_used}</b> graph facts used</div>
          </div>
        </div>`;
    }, 350);
  } catch (e) {
    clearTimeout(stageTimer1);
    resetTrace();
    els.result.innerHTML = `<div class="panel"><div class="empty">Pipeline error: ${e}. Check that the service is running and try again.</div></div>`;
  } finally {
    els.ask.disabled = false;
    els.ask.textContent = 'Run pipeline →';
  }
}

els.ask.addEventListener('click', runQuery);
els.question.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runQuery();
});
</script>
</body>
</html>"""
