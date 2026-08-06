"""
llm_provider.py
---------------
A single, provider-agnostic chat interface used by every agent.

Design idea: Groq, Google Gemini, Ollama, and OpenAI itself all expose an
OpenAI-compatible `/chat/completions` endpoint. That means one `openai.OpenAI`
client, pointed at a different `base_url`, is enough to support all four
providers -- no per-provider SDK sprawl.

Provider selection is automatic and prefers *free* options first:

    1. Groq        (free tier, very fast, needs GROQ_API_KEY)
    2. Gemini       (free tier via Google AI Studio, needs GOOGLE_API_KEY)
    3. Ollama       (100% free & local, needs Ollama running, no key)
    4. OpenAI       (paid, only used if OPENAI_API_KEY is set and nothing
                      free is available)
    5. Offline mode (no key / no local model found) -- a from-scratch,
       pure-Python answer engine (see scratch_engine.py) keeps the whole
       pipeline runnable for grading, demos, or CI with zero cost and zero
       network calls.

Every agent in this project talks to `get_llm().chat(system, user)` and
never needs to know which provider is actually behind it.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional

from src.config import settings
from src.scratch_engine import ScratchAnswerEngine, extract_entities_and_relations


@dataclass
class ProviderInfo:
    name: str
    model: str


class OfflineLLM:
    """
    Zero-dependency, zero-cost fallback used when no LLM provider is
    configured. It never calls the network. It is intentionally simple:
    it is NOT meant to replace a real LLM's reasoning quality, only to
    keep every agent in the pipeline runnable end-to-end so the system
    can be graded, demoed, or unit-tested without any API key. It uses the
    from-scratch `ScratchAnswerEngine` to rank and cite the most relevant
    sentences from the retrieved context.
    """

    info = ProviderInfo(name="offline-scratch-engine", model="n/a")

    def __init__(self):
        self._engine = ScratchAnswerEngine()

    def chat(self, system: str, user: str, temperature: float = 0.2) -> str:
        # The offline path never uses the free-text `system`/`user` prompt
        # semantically -- it just extracts the JSON-producing tasks our
        # agents ask for, or runs the scratch answer engine on the context.
        if "Return ONLY a JSON list of" in system or "extract" in system.lower():
            return self._extract_entities_and_relations(user)
        if "Decide if the context" in system:
            return self._reasoning_stub(user)
        return self._scratch_answer(user)

    # -- entity / relation extraction (from-scratch heuristic) ------------
    def _extract_entities_and_relations(self, text: str) -> str:
        return json.dumps(extract_entities_and_relations(text))

    def _reasoning_stub(self, user: str) -> str:
        # A real keyword-sufficiency check: if every key term in the question
        # is already covered by the retrieved context, we're done; otherwise
        # we ask for one more hop so the graph traversal can fill the gap.
        from src.scratch_engine import tokenize

        question = ""
        m = re.search(r"Question:\s*(.*?)(?:\n\n|\Z)", user, re.S)
        if m:
            question = m.group(1).strip()

        context = ""
        ctx = re.search(r"Retrieved passages:\n(.*?)(?:\n\nGraph facts:|\Z)", user, re.S)
        if ctx:
            context = ctx.group(1)

        q_tokens = set(tokenize(question))
        c_tokens = set(tokenize(context))
        if not q_tokens:
            return json.dumps({"sufficient": True, "missing_entities": []})

        missing = [t for t in sorted(q_tokens) if t not in c_tokens]
        # If most of the question's key terms are already present, accept the
        # current retrieval rather than looping forever.
        sufficient = len(missing) == 0 or len(missing) <= max(1, len(q_tokens) // 2)
        return json.dumps({"sufficient": sufficient, "missing_entities": missing})

    def _scratch_answer(self, user: str) -> str:
        # Parse the SynthesisAgent prompt: Context, Graph facts, Question.
        context_block = ""
        ctx = re.search(r"Context:(.*?)Graph facts:", user, re.S)
        if ctx:
            context_block = ctx.group(1).strip()

        graph_facts = []
        gf = re.search(r"Graph facts:(.*?)Question:", user, re.S)
        if gf:
            raw = gf.group(1).strip() or "(none)"
            if raw and raw != "(none)":
                graph_facts = [line.strip() for line in raw.splitlines() if line.strip()]

        question = ""
        q = re.search(r"Question:\s*(.*)", user, re.S)
        if q:
            question = q.group(1).strip()

        # Rebuild lightweight chunk objects from the `[chunk_id] text` lines.
        chunks = []
        for line in context_block.splitlines():
            mm = re.match(r"\[(.+?)\]\s*(.*)", line.strip())
            if mm:
                chunks.append(_PromptChunk(mm.group(1), mm.group(2)))

        if not chunks:
            return "I couldn't find a grounded answer in the ingested documents for that question."
        return self._engine.answer(question, chunks, graph_facts)


class _PromptChunk:
    """Minimal chunk-like object so ScratchAnswerEngine can consume prompt text."""

    __slots__ = ("chunk_id", "text")

    def __init__(self, chunk_id: str, text: str):
        self.chunk_id = chunk_id
        self.text = text


class OpenAICompatibleLLM:
    """Wraps any OpenAI-compatible chat endpoint (OpenAI, Groq, Gemini, Ollama)."""

    def __init__(self, provider_name: str, model: str, api_key: str, base_url: Optional[str] = None):
        from openai import OpenAI  # imported lazily so offline mode has zero deps

        self.info = ProviderInfo(name=provider_name, model=model)
        self._model = model
        self._client = OpenAI(api_key=api_key or "not-needed", base_url=base_url)

    def chat(self, system: str, user: str, temperature: float = 0.2) -> str:
        response = self._client.chat.completions.create(
            model=self._model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return response.choices[0].message.content or ""


def get_llm():
    """Return the best available LLM client, free options first."""
    if settings.groq_api_key:
        return OpenAICompatibleLLM(
            "groq", settings.groq_model, settings.groq_api_key,
            base_url="https://api.groq.com/openai/v1",
        )
    if settings.google_api_key:
        return OpenAICompatibleLLM(
            "gemini", settings.gemini_model, settings.google_api_key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
    if _ollama_reachable():
        return OpenAICompatibleLLM(
            "ollama", settings.ollama_model, api_key="ollama",
            base_url=f"{settings.ollama_host}/v1",
        )
    if settings.openai_api_key:
        return OpenAICompatibleLLM("openai", settings.openai_model, settings.openai_api_key)

    return OfflineLLM()


def _ollama_reachable() -> bool:
    import socket
    from urllib.parse import urlparse

    try:
        parsed = urlparse(settings.ollama_host)
        with socket.create_connection((parsed.hostname, parsed.port or 11434), timeout=0.3):
            return True
    except OSError:
        return False
