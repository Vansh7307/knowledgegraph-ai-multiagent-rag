"""Reproducible local throughput and latency benchmark for the scratch engine."""

from __future__ import annotations

import json
import math
import platform
import statistics
import sys
import time

from src.scratch_engine import Chunk, GraphRAGEngine, PropertyGraph, TFIDF


def _distribution(samples_ms: list[float]) -> dict[str, float]:
    ordered = sorted(samples_ms)
    p95_index = max(0, math.ceil(len(ordered) * 0.95) - 1)
    return {
        "median_ms": round(statistics.median(ordered), 3),
        "p95_ms": round(ordered[p95_index], 3),
        "min_ms": round(ordered[0], 3),
        "max_ms": round(ordered[-1], 3),
    }


def run_benchmarks() -> dict:
    ingestion_chunks = [
        Chunk(f"throughput-{index}", "throughput.txt", "The Router uses BFS. The Extractor extracts Entity.")
        for index in range(500)
    ]
    ingestion_engine = GraphRAGEngine()
    started = time.perf_counter()
    ingestion_engine.ingest(ingestion_chunks)
    ingestion_seconds = time.perf_counter() - started

    graph = PropertyGraph()
    node_count = 10_000
    for index in range(node_count - 1):
        graph.add_edge(f"node-{index}", f"node-{index + 1}", "CONNECTS_TO", "benchmark", "synthetic chain")
    bfs_samples = []
    for _ in range(100):
        started = time.perf_counter()
        nodes, _ = graph.bfs(["node-0"], max_hops=2)
        bfs_samples.append((time.perf_counter() - started) * 1000)
    bfs_latency = _distribution(bfs_samples)
    bfs_latency["graph_nodes"] = node_count
    bfs_latency["max_hops"] = 2
    bfs_latency["visited_nodes"] = len(nodes)
    full_bfs_samples = []
    for _ in range(25):
        started = time.perf_counter()
        full_nodes, _ = graph.bfs(["node-0"], max_hops=node_count)
        full_bfs_samples.append((time.perf_counter() - started) * 1000)
    full_bfs_latency = _distribution(full_bfs_samples)
    full_bfs_latency["graph_nodes"] = node_count
    full_bfs_latency["visited_nodes"] = len(full_nodes)

    retrieval_chunks = [
        Chunk(f"retrieval-{index}", "retrieval.txt",
              f"Router uses BFS and PageRank. Document section {index} discusses GraphRAG Vector Search.")
        for index in range(1_000)
    ]
    vectorizer = TFIDF(retrieval_chunks)
    tfidf_samples = []
    for _ in range(50):
        started = time.perf_counter()
        vectorizer.score("GraphRAG Vector Search PageRank")
        tfidf_samples.append((time.perf_counter() - started) * 1000)
    tfidf_latency = _distribution(tfidf_samples)
    tfidf_latency["chunks"] = len(retrieval_chunks)

    query_chunks = retrieval_chunks[:100]
    query_engine = GraphRAGEngine()
    query_engine.ingest(query_chunks)
    questions = {
        "graph": "How is Router connected to BFS?",
        "text": "What is GraphRAG?",
        "hybrid": "Explain how Router uses BFS and how GraphRAG supports Vector Search.",
    }
    query_results = {}
    for name, question in questions.items():
        samples = []
        for _ in range(5):
            query_engine.query(question)
        for _ in range(50):
            started = time.perf_counter()
            result = query_engine.query(question)
            samples.append((time.perf_counter() - started) * 1000)
        query_results[name] = {
            **_distribution(samples),
            "strategy": result["strategy"],
            "under_10ms": _distribution(samples)["p95_ms"] < 10,
        }

    report = {
        "benchmark": "offline-scratch-engine-v1",
        "python": platform.python_version(),
        "platform": platform.platform(),
        "ingestion": {
            "chunks": len(ingestion_chunks),
            "elapsed_ms": round(ingestion_seconds * 1000, 3),
            "chunks_per_second": round(len(ingestion_chunks) / ingestion_seconds, 1) if ingestion_seconds else 0.0,
        },
        "bfs": {**bfs_latency, "under_5ms": bfs_latency["p95_ms"] < 5},
        "full_graph_bfs": full_bfs_latency,
        "tfidf_scoring": {**tfidf_latency, "under_10ms": tfidf_latency["p95_ms"] < 10},
        "agentic_queries": query_results,
    }
    report["all_query_p95_under_10ms"] = all(
        metrics["under_10ms"] for metrics in query_results.values()
    )
    report["thresholds_passed"] = (
        report["bfs"]["under_5ms"]
        and report["tfidf_scoring"]["under_10ms"]
        and report["all_query_p95_under_10ms"]
    )
    return report


if __name__ == "__main__":
    result = run_benchmarks()
    print(json.dumps(result, indent=2, sort_keys=True))
    if not result["thresholds_passed"]:
        sys.exit(1)
