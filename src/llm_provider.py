"""Legacy import compatibility: all responses are produced locally."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from src.scratch_engine import Chunk, ScratchAnswerEngine, extract_entities_and_relations


@dataclass(frozen=True)
class ProviderInfo:
    name: str = "local deterministic engine"


class OfflineLLM:
    """Compatibility adapter for older callers; it never performs network I/O."""

    info = ProviderInfo()

    def chat(self, system_prompt: str, user_prompt: str) -> str:
        if "json" in system_prompt.lower() or "entities" in system_prompt.lower():
            return json.dumps(extract_entities_and_relations(user_prompt))
        context = re.search(r"Context:\s*(.*?)\s*(?:Graph facts:|Question:)", user_prompt, re.S)
        question = re.search(r"Question:\s*(.*)", user_prompt, re.S)
        if context and question:
            chunks = []
            for index, match in enumerate(re.finditer(r"\[([^\]]+)\]\s*(.*?)(?=\n\[|$)", context.group(1), re.S)):
                chunks.append(Chunk(match.group(1), match.group(1).split("::", 1)[0], match.group(2).strip()))
            return ScratchAnswerEngine().answer(question.group(1).strip(), chunks, [])
        return "This local compatibility interface only returns answers grounded in ingested text."


def get_llm() -> OfflineLLM:
    return OfflineLLM()
