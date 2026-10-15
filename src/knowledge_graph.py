"""Compatibility facade over the custom in-memory property graph."""

from __future__ import annotations

from src.scratch_engine import Chunk, GraphRAGEngine, PropertyGraph


class KnowledgeGraphBuilder:
    def __init__(self):
        self.graph = PropertyGraph()
        self.engine = GraphRAGEngine()
        self.engine.graph = self.graph
        self.llm = type("LocalInfo", (), {"info": type("Info", (), {"name": "local deterministic engine"})()})()

    def add_chunk(self, chunk: Chunk) -> None:
        self.engine.ingest([chunk])

    def build(self, chunks: list[Chunk]) -> PropertyGraph:
        for chunk in chunks:
            self.add_chunk(chunk)
        return self.graph

    def build_with_cache(self, chunks: list[Chunk], cache_path: str) -> PropertyGraph:
        del cache_path
        return self.build(chunks)


def facts_for_entities(graph: PropertyGraph, entities: list[str], hops: int = 2) -> list[str]:
    _, edges = graph.bfs(entities, max_hops=hops)
    return [f"{edge.source} --{edge.relation}--> {edge.target} (source: {edge.chunk_id})" for edge in edges]


def _graph_to_vis(graph: PropertyGraph) -> dict:
    return {
        "nodes": [{"id": name, "label": name, "type": entity.entity_type, "degree": graph.degree(name)}
                  for name, entity in graph.nodes.items()],
        "links": [{"source": edge.source, "target": edge.target, "relation": edge.relation,
                   "chunk_id": edge.chunk_id} for edge in graph.edges],
    }
