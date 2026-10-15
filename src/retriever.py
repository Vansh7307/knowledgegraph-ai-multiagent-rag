"""Local TF-IDF retriever implemented with standard-library math only."""

from __future__ import annotations

from src.scratch_engine import Chunk, TFIDF


class HybridRetriever:
    def __init__(self, chunks: list[Chunk]):
        self.chunks = chunks
        self.vectorizer = TFIDF(chunks)

    def top_chunks(self, query: str, k: int) -> list[Chunk]:
        ranked = self.vectorizer.score(query)
        matches = [chunk for score, chunk in ranked if score > 0]
        return matches[:k] if matches else [chunk for _, chunk in ranked[:k]]

    def match_entities(self, query: str, known_entities: list[str]) -> list[str]:
        lowered = query.lower()
        return [entity for entity in known_entities if entity.lower() in lowered]
