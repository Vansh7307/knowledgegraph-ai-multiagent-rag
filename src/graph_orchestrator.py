"""Small compatibility orchestrator using deterministic local agents."""

from __future__ import annotations

from src.knowledge_graph import facts_for_entities
from src.retriever import HybridRetriever
from src.scratch_engine import Chunk, PropertyGraph, ScratchAnswerEngine


class LocalQueryGraph:
    def __init__(self, retriever: HybridRetriever, graph: PropertyGraph, known_entities: list[str]):
        self.retriever = retriever
        self.graph = graph
        self.known_entities = known_entities

    def invoke(self, state: dict) -> dict:
        question = state["question"]
        chunks = self.retriever.top_chunks(question, 4)
        entities = self.retriever.match_entities(question, self.known_entities)
        facts = facts_for_entities(self.graph, entities, 2)
        answer = ScratchAnswerEngine().answer(question, chunks, facts)
        return {"question": question, "chunks": chunks, "entities": entities,
                "graph_facts": facts, "hop": 2 if facts else 1, "answer": answer}


def build_query_graph(retriever: HybridRetriever, kg: PropertyGraph, known_entities: list[str]):
    return LocalQueryGraph(retriever, kg, known_entities)
