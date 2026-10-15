"""Rule-based local agents retained as a thin compatibility interface."""

from __future__ import annotations

from src.scratch_engine import Chunk, ScratchAnswerEngine, extract_entities_and_relations, route_query, tokenize


class ExtractorAgent:
    def extract(self, text: str) -> dict:
        return extract_entities_and_relations(text)


class RouterAgent:
    def __init__(self, graph=None):
        self.graph = graph

    def route(self, question: str) -> dict:
        if self.graph is None:
            tokens = tokenize(question)
            relational = any(word in question.lower() for word in ("between", "connect", "relationship", "path"))
            strategy = "graph" if relational else "text" if len(tokens) <= 8 else "hybrid"
            return {"strategy": strategy, "reason": "Rule-scored query structure", "confidence": 0.72}
        result = route_query(question, self.graph)
        return {**result, "reason": "Weighted relational, interrogative, and entity-density features"}


class SynthesizerAgent:
    def answer(self, question: str, chunks: list, graph_facts: list[str]) -> str:
        return ScratchAnswerEngine().answer(question, chunks, graph_facts)


class ReasoningAgent:
    def evaluate(self, question: str, chunk_texts: list[str], graph_facts: list[str]) -> dict:
        query_tokens = set(tokenize(question))
        evidence_tokens = set(tokenize(" ".join(chunk_texts + graph_facts)))
        missing = sorted(query_tokens - evidence_tokens)
        return {"sufficient": bool(query_tokens & evidence_tokens), "missing_entities": missing}


SynthesisAgent = SynthesizerAgent
