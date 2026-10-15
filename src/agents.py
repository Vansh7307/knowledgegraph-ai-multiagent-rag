"""
agents.py
---------
Three distinct AI agents:

  ExtractorAgent  -- reads a document chunk, outputs JSON {entities, relations}
  RouterAgent     -- decides whether a query needs graph traversal or plain text search
  SynthesizerAgent -- formats raw graph/chunk data into a cited human-readable answer

The legacy ReasoningAgent and SynthesisAgent aliases are kept for
graph_orchestrator.py compatibility.
"""

from __future__ import annotations

import json
import logging

from src.llm_provider import get_llm

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# ExtractorAgent
# ---------------------------------------------------------------------------
_EXTRACTOR_PROMPT = """You are the Extractor Agent in a Knowledge Graph pipeline.
Read the passage and output ONLY JSON:
{"entities": [{"name": "...", "type": "Person|Organization|Technology|Concept|Place"}],
 "relations": [{"source": "...", "target": "...", "relation": "short verb phrase"}]}
No prose, no markdown fences. JSON only."""


class ExtractorAgent:
    """Reads a document chunk and outputs structured entities + relations."""

    def __init__(self):
        self.llm = get_llm()

    def extract(self, text: str) -> dict:
        raw = self.llm.chat(_EXTRACTOR_PROMPT, text)
        try:
            cleaned = raw.strip().strip("`").split("\n", 1)[-1] if raw.strip().startswith("```") else raw.strip()
            return json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning("ExtractorAgent: non-JSON output, returning empty")
            return {"entities": [], "relations": []}


# ---------------------------------------------------------------------------
# RouterAgent
# ---------------------------------------------------------------------------
_ROUTER_PROMPT = """You are the Router Agent in a multi-agent RAG system.
Given a user question, decide the best retrieval strategy.

Return ONLY JSON: {"strategy": "graph" | "text" | "hybrid", "reason": "one sentence"}
- "graph"  : question asks about relationships, connections, or multi-hop reasoning
- "text"   : question asks for a definition or factual summary from a single passage
- "hybrid" : question needs both
JSON only."""


class RouterAgent:
    """Decides whether a query needs graph traversal, text search, or both."""

    def __init__(self):
        self.llm = get_llm()

    def route(self, question: str) -> dict:
        raw = self.llm.chat(_ROUTER_PROMPT, f"Question: {question}")
        try:
            cleaned = raw.strip().strip("`")
            return json.loads(cleaned)
        except json.JSONDecodeError:
            return {"strategy": "hybrid", "reason": "fallback"}


# ---------------------------------------------------------------------------
# SynthesizerAgent  (also aliased as SynthesisAgent for orchestrator compat)
# ---------------------------------------------------------------------------
_SYNTHESIZER_PROMPT = """You are the Synthesizer Agent in a multi-agent Graph RAG system.

Priority order:
1. Answer using the provided context and graph facts. Cite chunk ids in square brackets, e.g. [doc::chunk0].
2. If context is insufficient, answer from general knowledge but prefix that section with:
   [General knowledge -- not from the ingested documents]
3. Never blend cited and uncited claims without the tag.

Be concise and direct."""


class SynthesizerAgent:
    def __init__(self):
        self.llm = get_llm()

    def answer(self, question: str, chunks: list, graph_facts: list[str]) -> str:
        context_block = "\n\n".join(f"[{c.chunk_id}] {c.text}" for c in chunks)
        user_prompt = (
            f"Context:\n{context_block}\n\n"
            f"Graph facts:\n{chr(10).join(graph_facts) or '(none)'}\n\n"
            f"Question: {question}"
        )
        return self.llm.chat(_SYNTHESIZER_PROMPT, user_prompt)


# ---------------------------------------------------------------------------
# Legacy aliases (used by graph_orchestrator.py)
# ---------------------------------------------------------------------------
_REASONING_PROMPT = """You are the Reasoning Agent in a multi-agent Graph RAG system.
Decide if the context below is sufficient to answer the question.

Return ONLY JSON: {"sufficient": true/false, "missing_entities": ["Entity"]}
JSON only, no prose."""


class ReasoningAgent:
    def __init__(self):
        self.llm = get_llm()

    def evaluate(self, question: str, chunk_texts: list[str], graph_facts: list[str]) -> dict:
        user_prompt = (
            f"Question: {question}\n\n"
            f"Retrieved passages:\n{chr(10).join(chunk_texts) or '(none)'}\n\n"
            f"Graph facts:\n{chr(10).join(graph_facts) or '(none)'}"
        )
        raw = self.llm.chat(_REASONING_PROMPT, user_prompt)
        try:
            return json.loads(raw.strip().strip("`"))
        except json.JSONDecodeError:
            return {"sufficient": True, "missing_entities": []}


# SynthesisAgent alias kept for graph_orchestrator.py
SynthesisAgent = SynthesizerAgent
