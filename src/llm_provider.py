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
    5. Offline mode (no key / no local model found) -- a lightweight
       rule-based fallback keeps the whole pipeline runnable for grading,
       demos, or CI with zero cost and zero network calls.

Every agent in this project talks to `get_llm().chat(system, user)` and
never needs to know which provider is actually behind it.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional

from src.config import settings


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
    can be graded, demoed, or unit-tested without any API key.
    """

    info = ProviderInfo(name="offline-rule-based", model="n/a")

    _STOPWORDS = {
        "the", "a", "an", "is", "are", "was", "were", "of", "and", "or",
        "in", "on", "for", "to", "by", "with", "as", "that", "this",
        "it", "its", "which", "who", "what", "how", "why", "does", "do",
    }

    def chat(self, system: str, user: str, temperature: float = 0.2) -> str:
        # The offline path never uses the free-text `system`/`user` prompt
        # semantically -- it just extracts the JSON-producing tasks our
        # agents ask for, or falls back to naive extractive text.
        if "Return ONLY a JSON list of" in system or "extract" in system.lower():
            return self._extract_entities_and_relations(user)
        if "Decide if the context" in system:
            return self._reasoning_stub(user)
        return self._extractive_answer(user)

    # -- entity / relation extraction (regex heuristic) -------------------
    def _extract_entities_and_relations(self, text: str) -> str:
        candidates = re.findall(r"\b(?:[A-Z][a-zA-Z0-9\-]*(?:\s+[A-Z][a-zA-Z0-9\-]*)*)\b", text)
        entities = sorted({c.strip() for c in candidates if len(c.strip()) > 2 and c.strip().lower() not in self._STOPWORDS})[:12]
        relations = []
        sentences = re.split(r"(?<=[.!?])\s+", text)
        for sent in sentences:
            present = [e for e in entities if e in sent]
            for i in range(len(present)):
                for j in range(i + 1, len(present)):
                    relations.append({
                        "source": present[i],
                        "target": present[j],
                        "relation": "related_to",
                    })
        return json.dumps({"entities": entities, "relations": relations[:20]})

    def _reasoning_stub(self, _user: str) -> str:
        # Offline mode never asks for another hop -- it always accepts
        # whatever was retrieved, since it cannot judge sufficiency well.
        return json.dumps({"sufficient": True, "missing_entities": []})

    def _extractive_answer(self, user: str) -> str:
        # Very naive extractive fallback: return the most relevant
        # sentences from the provided context verbatim-free (paraphrase-
        # free is fine here since it's the user's own ingested data).
        context_match = re.search(r"Context:\n(.*?)\n\nQuestion", user, re.S)
        context = context_match.group(1) if context_match else user
        sentences = re.split(r"(?<=[.!?])\s+", context)
        return " ".join(sentences[:3]) if sentences else "No answer could be generated offline."


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
