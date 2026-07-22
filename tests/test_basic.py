"""
Basic sanity tests. Run with: python -m pytest tests/ -v
These run fully offline (no API key needed) since they exercise the
rule-based fallback LLM, keeping CI free and deterministic.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.knowledge_graph import KnowledgeGraphBuilder, facts_for_entities
from src.retriever import HybridRetriever
from src.text_utils import Chunk, build_all_chunks, chunk_text


def test_chunking_produces_chunks():
    text = " ".join(f"word{i}" for i in range(300))
    chunks = chunk_text(text, "doc.txt", size_words=100, overlap_words=20)
    assert len(chunks) >= 3
    assert all(isinstance(c, Chunk) for c in chunks)
    assert chunks[0].chunk_id == "doc.txt::chunk0"


def test_build_all_chunks_from_sample_docs():
    chunks = build_all_chunks("data/sample_docs", size_words=120, overlap_words=20)
    assert len(chunks) > 0
    assert all(c.source.endswith(".txt") for c in chunks)


def test_knowledge_graph_builds_nodes_and_edges():
    chunks = build_all_chunks("data/sample_docs", size_words=120, overlap_words=20)
    builder = KnowledgeGraphBuilder()
    graph = builder.build(chunks[:2])
    assert graph.number_of_nodes() > 0


def test_retriever_returns_top_k():
    chunks = build_all_chunks("data/sample_docs", size_words=120, overlap_words=20)
    retriever = HybridRetriever(chunks)
    results = retriever.top_chunks("Transformer attention", k=3)
    assert 0 < len(results) <= 3


def test_facts_for_entities_handles_unknown_entity():
    import networkx as nx

    graph = nx.MultiDiGraph()
    graph.add_edge("A", "B", relation="related_to", chunk_id="x::chunk0")
    facts = facts_for_entities(graph, ["A"], hops=1)
    assert any("A" in f and "B" in f for f in facts)
    assert facts_for_entities(graph, ["Unknown"], hops=1) == []
