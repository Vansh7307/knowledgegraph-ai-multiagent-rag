"""
knowledge_graph.py
-------------------
The Graph Builder Agent: turns raw text chunks into a NetworkX knowledge
graph of entities connected by relations, with full provenance (every
edge remembers which chunk it came from, so answers can always be
traced back to source text).
"""

from __future__ import annotations

import json
import logging
import re

import networkx as nx

from src.llm_provider import get_llm
from src.text_utils import Chunk

logger = logging.getLogger(__name__)

EXTRACTION_SYSTEM_PROMPT = """You are an information-extraction agent in a Knowledge Graph pipeline.
Read the passage and extract the key named entities (people, organizations,
models, techniques, products) and the relations between them.

Return ONLY a JSON list of the form:
{"entities": ["Entity A", "Entity B"], "relations": [{"source": "Entity A", "target": "Entity B", "relation": "short verb phrase"}]}

No prose, no markdown fences, JSON only."""


class KnowledgeGraphBuilder:
    def __init__(self):
        self.llm = get_llm()
        self.graph = nx.MultiDiGraph()

    def add_chunk(self, chunk: Chunk) -> None:
        """Extract entities/relations from one chunk and merge into the graph."""
        raw = self.llm.chat(EXTRACTION_SYSTEM_PROMPT, chunk.text)
        parsed = self._safe_parse(raw)

        for entity in parsed.get("entities", []):
            self.graph.add_node(entity, mentions=self.graph.nodes.get(entity, {}).get("mentions", []) + [chunk.chunk_id])

        for rel in parsed.get("relations", []):
            src, tgt, label = rel.get("source"), rel.get("target"), rel.get("relation", "related_to")
            if not src or not tgt or src == tgt:
                continue
            self.graph.add_node(src)
            self.graph.add_node(tgt)
            self.graph.add_edge(src, tgt, relation=label, chunk_id=chunk.chunk_id, source_doc=chunk.source)

    def build(self, chunks: list[Chunk]) -> nx.MultiDiGraph:
        for chunk in chunks:
            self.add_chunk(chunk)
        logger.info("Knowledge graph built: %d nodes, %d edges", self.graph.number_of_nodes(), self.graph.number_of_edges())
        return self.graph

    @staticmethod
    def _safe_parse(raw: str) -> dict:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned

        # Some models add stray prose before/after the JSON object/list --
        # extract the outermost {...} or [...] block if a direct parse fails.
        def _try_load(s: str):
            try:
                return json.loads(s)
            except json.JSONDecodeError:
                return None

        parsed = _try_load(cleaned)
        if parsed is None:
            match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.S)
            if match:
                parsed = _try_load(match.group(1))

        if parsed is None:
            logger.warning("Could not parse extraction output, skipping chunk: %s", raw[:120])
            return {"entities": [], "relations": []}

        return KnowledgeGraphBuilder._normalize(parsed)

    @staticmethod
    def _normalize(parsed) -> dict:
        """Coerce whatever shape the LLM returned into {"entities": [...], "relations": [...]}."""
        if isinstance(parsed, dict):
            entities = parsed.get("entities", [])
            relations = parsed.get("relations", [])
        elif isinstance(parsed, list):
            # The model returned a bare list -- figure out what kind.
            if all(isinstance(item, str) for item in parsed):
                entities, relations = parsed, []
            elif all(isinstance(item, dict) for item in parsed):
                # Could be a list of relation dicts, or a list containing
                # one {"entities":..., "relations":...} object.
                if len(parsed) == 1 and ("entities" in parsed[0] or "relations" in parsed[0]):
                    entities = parsed[0].get("entities", [])
                    relations = parsed[0].get("relations", [])
                else:
                    relations = [r for r in parsed if "source" in r and "target" in r]
                    entities = sorted({r["source"] for r in relations} | {r["target"] for r in relations})
            else:
                entities, relations = [], []
        else:
            entities, relations = [], []

        # Final safety net: make sure both are the right shape.
        entities = [e for e in entities if isinstance(e, str)]
        relations = [r for r in relations if isinstance(r, dict) and r.get("source") and r.get("target")]
        return {"entities": entities, "relations": relations}


def facts_for_entities(graph: nx.MultiDiGraph, entities: list[str], hops: int = 2) -> list[str]:
    """Return human-readable graph facts within `hops` of the given entities."""
    facts: list[str] = []
    seen_nodes = {e for e in entities if e in graph}
    frontier = set(seen_nodes)

    for _ in range(hops):
        next_frontier = set()
        for node in frontier:
            for _, target, data in graph.out_edges(node, data=True):
                facts.append(f"{node} --{data.get('relation', 'related_to')}--> {target} (source: {data.get('chunk_id')})")
                next_frontier.add(target)
            for source, _, data in graph.in_edges(node, data=True):
                facts.append(f"{source} --{data.get('relation', 'related_to')}--> {node} (source: {data.get('chunk_id')})")
                next_frontier.add(source)
        frontier = next_frontier - seen_nodes
        seen_nodes |= next_frontier
        if not frontier:
            break

    # de-duplicate while preserving order
    return list(dict.fromkeys(facts))