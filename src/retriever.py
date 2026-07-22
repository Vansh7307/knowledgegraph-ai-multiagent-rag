"""
retriever.py
------------
The Retrieval Agent. Combines two retrieval signals:

  1. Lexical similarity search (BM25) over the document chunks -- fast,
     free, no embeddings model required.
  2. Entity matching against the Knowledge Graph, to pull in connected
     facts that a pure similarity search would miss (this is what makes
     it "Graph RAG" instead of plain RAG).
"""

from __future__ import annotations

import re

from rank_bm25 import BM25Okapi

from src.text_utils import Chunk


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z0-9]+", text.lower())


class HybridRetriever:
    def __init__(self, chunks: list[Chunk]):
        self.chunks = chunks
        self._corpus_tokens = [_tokenize(c.text) for c in chunks]
        self.bm25 = BM25Okapi(self._corpus_tokens) if chunks else None

    def top_chunks(self, query: str, k: int) -> list[Chunk]:
        if not self.bm25:
            return []
        scores = self.bm25.get_scores(_tokenize(query))
        ranked = sorted(zip(scores, self.chunks), key=lambda pair: pair[0], reverse=True)
        return [chunk for score, chunk in ranked[:k] if score > 0] or [c for _, c in ranked[:k]]

    def match_entities(self, query: str, known_entities: list[str]) -> list[str]:
        """Return graph entities that are literally mentioned in the query."""
        query_lower = query.lower()
        return [e for e in known_entities if e.lower() in query_lower]
