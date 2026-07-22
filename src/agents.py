"""
agents.py
---------
The Reasoning Agent and the Synthesis Agent -- the two LLM-driven agents
that operate at query time, after the Retrieval Agent has gathered
candidate context (see retriever.py and graph_orchestrator.py).
"""

from __future__ import annotations

import json
import logging

from src.llm_provider import get_llm

logger = logging.getLogger(__name__)

REASONING_SYSTEM_PROMPT = """You are the Reasoning Agent in a multi-agent Graph RAG system.
Decide if the context below is sufficient to answer the question.

Return ONLY JSON: {"sufficient": true/false, "missing_entities": ["Entity"]}
"missing_entities" should list any entity mentioned in the context or
question that would need one more hop of graph traversal to answer fully.
JSON only, no prose."""

SYNTHESIS_SYSTEM_PROMPT = """You are the Synthesis Agent in a multi-agent Graph RAG system.
Answer the user's question using ONLY the provided context and graph facts.
Cite the chunk id(s) you used in square brackets, e.g. [01_transformers.txt::chunk0].
If the context does not contain the answer, say so honestly instead of guessing."""


class ReasoningAgent:
    def __init__(self):
        self.llm = get_llm()

    def evaluate(self, question: str, chunk_texts: list[str], graph_facts: list[str]) -> dict:
        user_prompt = (
            f"Question: {question}\n\n"
            f"Retrieved passages:\n{chr(10).join(chunk_texts) or '(none)'}\n\n"
            f"Graph facts:\n{chr(10).join(graph_facts) or '(none)'}"
        )
        raw = self.llm.chat(REASONING_SYSTEM_PROMPT, user_prompt)
        try:
            cleaned = raw.strip().strip("`")
            return json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning("ReasoningAgent got non-JSON output, defaulting to sufficient=True")
            return {"sufficient": True, "missing_entities": []}


class SynthesisAgent:
    def __init__(self):
        self.llm = get_llm()

    def answer(self, question: str, chunks: list, graph_facts: list[str]) -> str:
        context_block = "\n\n".join(f"[{c.chunk_id}] {c.text}" for c in chunks)
        user_prompt = (
            f"Context:\n{context_block}\n\n"
            f"Graph facts:\n{chr(10).join(graph_facts) or '(none)'}\n\n"
            f"Question: {question}"
        )
        return self.llm.chat(SYNTHESIS_SYSTEM_PROMPT, user_prompt)
