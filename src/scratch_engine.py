"""
scratch_engine.py
-----------------
A pure-Python, zero-dependency "from scratch" answer engine. It replaces the
old naive offline fallback (which just returned the first 3 sentences
verbatim) with a real, self-contained question-answering routine:

  * sentence-splits the retrieved context into candidate evidence,
  * scores each sentence by query-keyword overlap (BM25-style IDF term
    weighting) plus a bonus when the sentence mentions graph-fact entities,
  * de-duplicates and picks the top-ranked, most relevant sentences,
  * assembles a concise, fluent answer that cites the exact chunk each
    sentence came from, and
  * returns a clear "no grounded answer" message when nothing matches.

It never calls the network and needs no API key, so the whole pipeline runs
end-to-end offline. When a real LLM provider is configured (Groq/Gemini/
Ollama/OpenAI), the API-key path in llm_provider.py is used instead and this
module is ignored -- so the two answer paths coexist cleanly.
"""

from __future__ import annotations

import re
import string
from dataclasses import dataclass

# ---------------------------------------------------------------- helpers ---

_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "of", "and", "or", "in", "on", "at", "to", "for", "from", "by", "with",
    "as", "that", "this", "these", "those", "it", "its", "which", "who",
    "whom", "what", "how", "why", "when", "where", "does", "do", "did",
    "not", "no", "yes", "if", "then", "than", "so", "such", "can", "could",
    "would", "should", "will", "but", "they", "them", "their", "we", "you",
    "your", "he", "she", "his", "her", "there", "here", "about",
}

_IDF_D = 1.0  # default idf for terms that appear in no document (safety)


def normalize(text: str) -> str:
    """Lowercase and strip punctuation/whitespace for matching."""
    return " ".join(text.lower().translate(str.maketrans("", "", string.punctuation)).split())


def tokenize(text: str) -> list[str]:
    """Split into lowercase alphanumeric tokens, keeping short/meaningful ones."""
    return [t for t in re.findall(r"[a-zA-Z0-9]+", text.lower()) if t not in _STOPWORDS]


def sentence_split(text: str) -> list[str]:
    """Split text into sentences, keeping each sentence's original length."""
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]


def _idf(term: str, document_token_counts: list[dict[str, int]], n_docs: int) -> float:
    containing = sum(1 for doc in document_token_counts if term in doc)
    if containing == 0:
        return _IDF_D
    return 1.0 + __import__("math").log((1 + n_docs) / (1 + containing))


# ------------------------------------------------------------- the engine ---

@dataclass
class _ScoredSentence:
    text: str
    chunk_id: str
    score: float


class ScratchAnswerEngine:
    """Answers a question from a set of document chunks using pure-Python scoring."""

    def __init__(self):
        # Pre-tokenize the corpus once so repeated scoring is fast.
        self._chunks: list[tuple[str, str, list[str]]] = []  # (chunk_id, text, tokens)
        self._doc_term_counts: list[dict[str, int]] = []
        self._n_docs = 0

    def load(self, chunks) -> None:
        """Accept either our `Chunk` dataclass or any object with `.chunk_id`/`.text`."""
        self._chunks = []
        self._doc_term_counts = []
        for c in chunks:
            toks = tokenize(c.text)
            self._chunks.append((c.chunk_id, c.text, toks))
            counts: dict[str, int] = {}
            for t in toks:
                counts[t] = counts.get(t, 0) + 1
            self._doc_term_counts.append(counts)
        self._n_docs = len(self._chunks)

    # -- BM25-style term weighting over the whole corpus -----------------
    def _term_weights(self, query_tokens: list[str]) -> dict[str, float]:
        weights: dict[str, float] = {}
        for t in query_tokens:
            idf = _idf(t, self._doc_term_counts, self._n_docs)
            weights[t] = weights.get(t, 0.0) + idf
        return weights

    def _score_sentence(
        self,
        sent_tokens: list[str],
        weights: dict[str, float],
        graph_entity_tokens: set[str],
    ) -> float:
        if not sent_tokens:
            return 0.0
        score = sum(weights.get(t, 0.0) for t in sent_tokens)
        # Normalize by sentence length so long filler sentences don't dominate.
        score /= (len(sent_tokens) ** 0.5) or 1.0
        # Bonus when the sentence mentions an entity that appeared in graph facts.
        if graph_entity_tokens:
            hit = sum(1 for t in set(sent_tokens) if t in graph_entity_tokens)
            score += hit * 1.5
        return score

    def answer(
        self,
        question: str,
        chunks,
        graph_facts: list[str],
        max_sentences: int = 3,
    ) -> str:
        if not self._chunks:
            self.load(chunks)

        query_tokens = tokenize(question)
        if not query_tokens:
            return "I couldn't find a grounded answer in the ingested documents."

        weights = self._term_weights(query_tokens)

        # Collect graph-fact entity tokens to reward sentences about them.
        fact_tokens: set[str] = set()
        for fact in graph_facts:
            # Format like: "A --rel--> B (source: doc::chunk0)"
            parts = re.split(r"\s*--.*?-->\s*", fact)
            for p in parts:
                fact_tokens.update(tokenize(p))

        scored: list[_ScoredSentence] = []
        for chunk_id, text, _toks in self._chunks:
            for sent in sentence_split(text):
                stok = tokenize(sent)
                if not stok:
                    continue
                s = self._score_sentence(stok, weights, fact_tokens)
                if s > 0:
                    scored.append(_ScoredSentence(sent, chunk_id, s))

        # Sort by score desc, then de-duplicate near-identical sentences.
        scored.sort(key=lambda x: x.score, reverse=True)
        chosen: list[_ScoredSentence] = []

        def _already_have(s: _ScoredSentence) -> bool:
            sn = normalize(s.text)
            return any(normalize(c.text) == sn or s.text in c.text or c.text in s.text for c in chosen)

        for s in scored:
            if len(chosen) >= max_sentences:
                break
            if not _already_have(s):
                chosen.append(s)

        if not chosen:
            return "I couldn't find a grounded answer in the ingested documents for that question."

        answer_lines: list[str] = []
        for s in chosen:
            answer_lines.append(f"{s.text} [{s.chunk_id}]")
        return " ".join(answer_lines)


# ------------------------------------------------------------------ exports ---

def extract_entities_and_relations(text: str, max_entities: int = 12) -> dict:
    """
    Lightweight from-scratch entity/relation extractor for the graph builder.

    Uses heuristics (proper-noun patterns + sentence co-occurrence) instead of
    an LLM, so the knowledge graph can be built fully offline. Returns the same
    shape the LLM extraction prompt expects:
        {"entities": [...], "relations": [...]}
    """
    entities = sorted(
        {e for e in re.findall(r"\b(?:[A-Z][a-zA-Z0-9\-]*(?:\s+[A-Z][a-zA-Z0-9\-]*)*)\b", text) if len(e.strip()) > 2}
    )[:max_entities]

    relations = []
    for sent in sentence_split(text):
        present = [e for e in entities if e in sent]
        for i in range(len(present)):
            for j in range(i + 1, len(present)):
                relations.append({
                    "source": present[i],
                    "target": present[j],
                    "relation": "related_to",
                })

    return {"entities": entities, "relations": relations}
