"""
main.py
-------
Script version of the KnowledgeGraph AI Multi-Agent RAG System.

Usage:
    python -m src.main "What is the relationship between BERT and GPT?"
    python -m src.main                     # runs a small demo Q&A set
"""

from __future__ import annotations

import logging
import sys

from src.config import settings
from src.graph_orchestrator import build_query_graph
from src.knowledge_graph import KnowledgeGraphBuilder
from src.retriever import HybridRetriever
from src.text_utils import build_all_chunks

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger("main")

DEMO_QUESTIONS = [
    "What is Self-Attention and why does it matter for Transformers?",
    "How is BERT related to the Transformer architecture Google introduced?",
    "What company built ChatGPT, and how does RLHF fit into that story?",
    "How does Graph RAG differ from plain Retrieval-Augmented Generation?",
]


def run_pipeline(questions: list[str]) -> None:
    logger.info("Ingesting documents from %s ...", settings.data_dir)
    chunks = build_all_chunks(settings.data_dir, settings.chunk_size_words, settings.chunk_overlap_words)
    logger.info("Loaded %d chunks", len(chunks))

    logger.info("Building knowledge graph (Graph Builder Agent) ...")
    kg_builder = KnowledgeGraphBuilder()
    graph = kg_builder.build(chunks)
    logger.info("LLM provider in use: %s", kg_builder.llm.info)

    retriever = HybridRetriever(chunks)
    query_graph = build_query_graph(retriever, graph, list(graph.nodes))

    for question in questions:
        print("\n" + "=" * 80)
        print(f"Q: {question}")
        result = query_graph.invoke({"question": question, "hop": 0})
        print(f"\nA: {result['answer']}")
        print(f"\n(resolved in {result['hop']} reasoning hop(s), "
              f"{len(result['chunks'])} chunk(s), {len(result['graph_facts'])} graph fact(s) used)")


if __name__ == "__main__":
    user_questions = sys.argv[1:] or DEMO_QUESTIONS
    run_pipeline(user_questions)
