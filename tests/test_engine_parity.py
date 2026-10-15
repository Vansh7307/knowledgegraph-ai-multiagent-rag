import json
import subprocess
from pathlib import Path

from src.scratch_engine import Chunk, GraphRAGEngine

ROOT = Path(__file__).resolve().parents[1]


def test_python_and_typescript_engines_match_shared_fixture():
    fixture = json.loads((ROOT / "tests" / "fixtures" / "engine_parity.json").read_text(encoding="utf-8"))
    completed = subprocess.run(
        ["node", str(ROOT / "tests" / "engine_parity_runner.cjs")],
        input=json.dumps(fixture),
        text=True,
        capture_output=True,
        cwd=ROOT,
        check=True,
    )
    typescript_result = json.loads(completed.stdout)
    engine = GraphRAGEngine()
    engine.ingest([Chunk(**chunk) for chunk in fixture["chunks"]])
    python_graph = engine.graph_payload()
    python_result = {
        "nodes": sorted(
            [{
                "id": node["id"],
                "type": node["type"],
                "degree": node["degree"],
                "in_degree": node["in_degree"],
                "out_degree": node["out_degree"],
                "pagerank": node["pagerank"],
            } for node in python_graph["nodes"]],
            key=lambda node: node["id"],
        ),
        "edges": sorted(
            [{
                "source": edge["source"],
                "target": edge["target"],
                "relation": edge["relation"],
                "chunk_id": edge["chunk_id"],
            } for edge in python_graph["links"]],
            key=lambda edge: (edge["source"], edge["target"], edge["relation"], edge["chunk_id"]),
        ),
    }
    python_nodes, python_edges = engine.graph.bfs(
        fixture["traversal"]["starts"], fixture["traversal"]["max_hops"])
    python_result["traversal"] = {
        "nodes": sorted(python_nodes),
        "edges": [{
            "source": edge.source,
            "target": edge.target,
            "relation": edge.relation,
            "chunk_id": edge.chunk_id,
        } for edge in sorted(python_edges, key=lambda edge: (
            edge.source, edge.target, edge.relation, edge.chunk_id))],
    }
    python_result["queries"] = []
    for question in fixture["queries"]:
        query = engine.query(question)
        python_result["queries"].append({
            "strategy": query["strategy"],
            "confidence": query["confidence"],
            "confidence_breakdown": query["confidence_breakdown"],
            "hops": query["hops"],
            "path_nodes": query["path_nodes"],
            "ranked_chunks": [
                {"id": chunk["id"], "score": chunk["score"]}
                for chunk in query["source_chunks"]
            ],
            "graph_facts": query["graph_facts"],
        })
    assert python_result["queries"][0]["hops"] == 2
    assert python_result["queries"][0]["path_nodes"] == ["Router", "Vector Search", "TF-IDF"]
    assert python_result == typescript_result
