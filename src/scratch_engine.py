"""Deterministic, dependency-free GraphRAG primitives and agents."""

from __future__ import annotations

import math
import re
import time
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "by", "can", "do",
    "does", "for", "from", "how", "i", "in", "is", "it", "its", "of", "on",
    "or", "that", "the", "their", "this", "to", "was", "what", "when",
    "where", "which", "who", "why", "with",
}
RELATIONS = {
    "uses": "USES", "use": "USES", "utilizes": "USES", "utilizes": "USES",
    "orchestrates": "ORCHESTRATES", "orchestrate": "ORCHESTRATES",
    "writes": "WRITES_TO", "stores": "WRITES_TO", "persists": "WRITES_TO",
    "computes": "COMPUTES", "calculates": "COMPUTES", "ranks": "COMPUTES",
    "routes": "ROUTES_TO", "routes_to": "ROUTES_TO",
    "powers": "POWERS", "prevents": "PREVENTS", "built": "BUILT_ON",
    "connects": "CONNECTS_TO", "connect": "CONNECTS_TO", "links": "CONNECTS_TO",
    "retrieves": "RETRIEVES", "extracts": "EXTRACTS", "contains": "CONTAINS",
    "combines": "COMBINES", "creates": "CREATES", "generates": "GENERATES",
    "is": "IS_A", "are": "IS_A", "enables": "ENABLES", "supports": "SUPPORTS",
}
DOMAIN_TERMS = {
    "GraphRAG": "Architecture", "RAG": "Architecture", "Knowledge Graph": "Database",
    "Property Graph": "Database", "TF-IDF": "Algorithm", "TFIDF": "Algorithm",
    "BFS": "Algorithm", "Dijkstra": "Algorithm", "PageRank": "Metric",
    "Cosine Similarity": "Algorithm", "Vector Search": "Algorithm",
    "Extractor": "Agent", "Router": "Agent", "Synthesizer": "Agent",
    "Transformer": "Architecture", "Self-Attention": "Algorithm",
    "Neo4j": "Database", "SQLite": "Database", "PostgreSQL": "Database",
    "Python": "Component", "TypeScript": "Component", "FastAPI": "Component",
    "Next.js": "Component", "React": "Component", "OpenAI": "Component",
    "BERT": "Architecture", "GPT": "Architecture", "ChatGPT": "Component",
    "Multi-Agent": "Architecture", "Multi-Agent System": "Architecture",
    "Embedding": "Concept", "Embeddings": "Concept", "Chunk": "Concept",
    "Entity": "Concept", "Relationship": "Concept", "IDF": "Metric",
    "TF": "Metric", "API": "Component", "PDF": "Component",
}


def tokenize(text: str) -> list[str]:
    return [word.lower() for word in re.findall(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*", text)
            if word.lower() not in STOPWORDS]


def sentence_split(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", text.strip()) if part.strip()]


@dataclass
class Chunk:
    chunk_id: str
    source: str
    text: str


def chunk_text(text: str, source: str, size_words: int = 120, overlap_words: int = 20) -> list[Chunk]:
    words = text.split()
    if not words:
        return []
    size = max(1, size_words)
    step = max(1, size - max(0, overlap_words))
    chunks = []
    for start in range(0, len(words), step):
        part = " ".join(words[start:start + size])
        if not part:
            break
        chunks.append(Chunk(f"{source}::chunk{len(chunks)}", source, part))
        if start + size >= len(words):
            break
    return chunks


@dataclass
class Entity:
    name: str
    entity_type: str = "Concept"
    mentions: list[str] = field(default_factory=list)


@dataclass
class Edge:
    source: str
    target: str
    relation: str
    chunk_id: str
    source_text: str


class PropertyGraph:
    """Directed property graph with forward/reverse adjacency and keyword index."""

    def __init__(self) -> None:
        self.nodes: dict[str, Entity] = {}
        self.outgoing: dict[str, list[Edge]] = defaultdict(list)
        self.incoming: dict[str, list[Edge]] = defaultdict(list)
        self.keyword_index: dict[str, set[str]] = defaultdict(set)
        self.edges: list[Edge] = []
        self._rank: dict[str, float] = {}

    def add_node(self, name: str, entity_type: str = "Concept", chunk_id: str = "") -> None:
        name = name.strip()
        if not name:
            return
        if name not in self.nodes:
            self.nodes[name] = Entity(name, entity_type)
            self._rank.clear()
            for token in tokenize(name):
                self.keyword_index[token].add(name)
        elif self.nodes[name].entity_type == "Concept" and entity_type != "Concept":
            self.nodes[name].entity_type = entity_type
        if chunk_id and chunk_id not in self.nodes[name].mentions:
            self.nodes[name].mentions.append(chunk_id)

    def add_edge(self, source: str, target: str, relation: str, chunk_id: str, source_text: str) -> None:
        if source == target:
            return
        self.add_node(source, chunk_id=chunk_id)
        self.add_node(target, chunk_id=chunk_id)
        if any(e.target == target and e.relation == relation and e.chunk_id == chunk_id
               for e in self.outgoing[source]):
            return
        edge = Edge(source, target, relation, chunk_id, source_text)
        self.edges.append(edge)
        self.outgoing[source].append(edge)
        self.incoming[target].append(edge)
        self._rank.clear()

    def degree(self, name: str) -> int:
        return len(self.incoming[name]) + len(self.outgoing[name])

    def number_of_nodes(self) -> int:
        return len(self.nodes)

    def number_of_edges(self) -> int:
        return len(self.edges)

    def bfs(self, starts: list[str], max_hops: int = 2) -> tuple[list[str], list[Edge]]:
        start_nodes = list(dict.fromkeys(name for name in starts if name in self.nodes))
        reached = set(start_nodes)
        queue = deque((name, 0) for name in start_nodes)
        found: list[Edge] = []
        seen_edges: set[int] = set()
        while queue:
            node, depth = queue.popleft()
            if depth >= max_hops:
                continue
            for edge in self.outgoing[node] + self.incoming[node]:
                key = id(edge)
                if key not in seen_edges:
                    found.append(edge)
                    seen_edges.add(key)
                other = edge.target if edge.source == node else edge.source
                if other not in reached:
                    reached.add(other)
                    queue.append((other, depth + 1))
        return [name for name in self.nodes if name in reached], found

    def shortest_path(self, source: str, target: str) -> list[Edge]:
        if source not in self.nodes or target not in self.nodes:
            return []
        queue = deque([source])
        parent: dict[str, tuple[str, Edge] | None] = {source: None}
        while queue:
            node = queue.popleft()
            if node == target:
                break
            for edge in self.outgoing[node] + self.incoming[node]:
                other = edge.target if edge.source == node else edge.source
                if other not in parent:
                    parent[other] = (node, edge)
                    queue.append(other)
        if target not in parent:
            return []
        path: list[Edge] = []
        node = target
        while parent[node] is not None:
            previous, edge = parent[node]  # type: ignore[misc]
            path.append(edge)
            node = previous
        return list(reversed(path))

    def pagerank(self, iterations: int = 30, damping: float = 0.85) -> dict[str, float]:
        if not self.nodes:
            return {}
        if self._rank:
            return self._rank
        names = list(self.nodes)
        n = len(names)
        rank = {name: 1.0 / n for name in names}
        for _ in range(iterations):
            updated = {name: (1 - damping) / n for name in names}
            dangling = sum(rank[name] for name in names if not self.outgoing[name])
            for name in names:
                updated[name] += damping * dangling / n
                for edge in self.incoming[name]:
                    degree = len(self.outgoing[edge.source])
                    if degree:
                        updated[name] += damping * rank[edge.source] / degree
            rank = updated
        self._rank = rank
        return rank

    def cypher_for(self, edges: list[Edge]) -> str:
        return "\n".join(
            f"MATCH (s)-[r:{e.relation}]->(o) WHERE s.name = '{e.source.replace(chr(39), chr(39) * 2)}' "
            f"AND o.name = '{e.target.replace(chr(39), chr(39) * 2)}'"
            for e in edges
        )


def classify_entity(name: str) -> str:
    normalized = name.strip()
    for phrase, entity_type in sorted(DOMAIN_TERMS.items(), key=lambda pair: -len(pair[0])):
        if normalized.lower() == phrase.lower():
            return entity_type
    if normalized.isupper() and 2 <= len(normalized) <= 8:
        return "Algorithm" if normalized in {"BFS", "TF", "IDF", "API"} else "Concept"
    if re.search(r"\b(?:architecture|framework|system|pipeline|model)\b", normalized, re.I):
        return "Architecture"
    if re.search(r"\b(?:agent|router|extractor|synthesizer)\b", normalized, re.I):
        return "Agent"
    return "Concept"


def extract_entities_and_relations(text: str, max_entities: int = 80) -> dict:
    found: dict[str, str] = {}
    for phrase, entity_type in DOMAIN_TERMS.items():
        if re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", text, re.I):
            found[phrase] = entity_type
    # Capitalized noun phrases and acronyms supplement the technical lexicon.
    for match in re.finditer(r"\b(?:[A-Z][A-Za-z0-9.+#-]*(?:\s+[A-Z][A-Za-z0-9.+#-]*){0,3})\b", text):
        name = re.sub(r"^(?:The|A|An)\s+", "", match.group(0).strip(" .,:;"))
        if len(name) > 1 and name.lower() not in STOPWORDS:
            found.setdefault(name, classify_entity(name))
    entities = sorted(found, key=lambda item: (-len(item), item))[:max_entities]
    relations: list[dict] = []
    for sentence in sentence_split(text):
        present = [name for name in entities if re.search(rf"(?<!\w){re.escape(name)}(?!\w)", sentence, re.I)]
        present.sort(key=lambda name: sentence.lower().find(name.lower()))
        if len(present) < 2:
            continue
        relation = "CONNECTS_TO"
        for verb, predicate in RELATIONS.items():
            if re.search(rf"\b{re.escape(verb)}\b", sentence, re.I):
                relation = predicate
                break
        subject, obj = present[0], present[1]
        if re.search(r"\b(?:built on|based on|powered by)\b", sentence, re.I):
            relation = "BUILT_ON"
        relations.append({"source": subject, "target": obj, "relation": relation, "text": sentence})
    return {"entities": entities, "typed_entities": [
        {"name": name, "type": found[name]} for name in entities], "relations": relations}


class TFIDF:
    def __init__(self, chunks: list[Chunk]) -> None:
        self.chunks = chunks
        self.tokens = [tokenize(chunk.text) for chunk in chunks]
        self.document_frequency = Counter(token for doc in self.tokens for token in set(doc))

    def score(self, query: str) -> list[tuple[float, Chunk]]:
        query_counts = Counter(tokenize(query))
        n_docs = len(self.chunks)
        query_vector = {}
        for term, count in query_counts.items():
            idf = math.log(n_docs / (1 + self.document_frequency[term])) if n_docs else 0.0
            query_vector[term] = (count / max(1, len(query_counts))) * idf
        query_norm = math.sqrt(sum(value * value for value in query_vector.values()))
        results = []
        for chunk, tokens in zip(self.chunks, self.tokens):
            counts = Counter(tokens)
            vector = {}
            for term in query_counts:
                idf = math.log(n_docs / (1 + self.document_frequency[term])) if n_docs else 0.0
                vector[term] = (counts[term] / max(1, len(tokens))) * idf
            norm = math.sqrt(sum(value * value for value in vector.values()))
            dot = sum(query_vector[t] * vector[t] for t in query_vector)
            similarity = dot / (query_norm * norm) if query_norm and norm else 0.0
            results.append((similarity, chunk))
        return sorted(results, key=lambda pair: pair[0], reverse=True)


def route_query(question: str, graph: PropertyGraph) -> dict:
    tokens = tokenize(question)
    relational = sum(bool(re.search(rf"\b{word}\b", question.lower())) for word in
                     ("connect", "connection", "relationship", "relate", "between", "path", "link", "route"))
    interrogative = int(bool(re.match(r"\s*(how|why|which|what|who|where|when)\b", question, re.I)))
    matched = [name for name in graph.nodes if re.search(rf"(?<!\w){re.escape(name)}(?!\w)", question, re.I)]
    density = min(1.0, len(matched) / max(1, len(tokens)))
    if relational and len(matched) >= 2:
        strategy = "graph"
    elif interrogative and len(tokens) <= 8 and not relational:
        strategy = "text"
    else:
        strategy = "hybrid"
    confidence = min(1.0, 0.45 + 0.15 * bool(relational) + 0.12 * interrogative + 0.2 * density)
    return {
        "strategy": strategy, "confidence": round(confidence, 2),
        "features": {"relational_terms": relational, "interrogative": interrogative,
                     "entity_density": round(density, 3), "matched_entities": matched},
    }


class GraphRAGEngine:
    def __init__(self) -> None:
        self.graph = PropertyGraph()
        self.chunks: list[Chunk] = []
        self._chunk_ids: set[str] = set()

    def ingest(self, chunks: list[Chunk]) -> None:
        for chunk in chunks:
            if chunk.chunk_id in self._chunk_ids:
                continue
            self._chunk_ids.add(chunk.chunk_id)
            self.chunks.append(chunk)
            extracted = extract_entities_and_relations(chunk.text)
            for entity in extracted["typed_entities"]:
                self.graph.add_node(entity["name"], entity["type"], chunk.chunk_id)
            for relation in extracted["relations"]:
                self.graph.add_edge(relation["source"], relation["target"], relation["relation"],
                                    chunk.chunk_id, relation["text"])

    def query(self, question: str) -> dict:
        started = time.perf_counter()
        route_started = time.perf_counter()
        route = route_query(question, self.graph)
        route_ms = max(0, round((time.perf_counter() - route_started) * 1000, 2))
        matched = route["features"]["matched_entities"]
        retrieval_started = time.perf_counter()
        scores = TFIDF(self.chunks).score(question)
        top = [(score, chunk) for score, chunk in scores[:4] if score > 0]
        graph_nodes, graph_edges = self.graph.bfs(matched, 2) if matched else ([], [])
        path_edges = []
        if len(matched) >= 2:
            path_edges = self.graph.shortest_path(matched[0], matched[1])
        traversed = list(dict.fromkeys(id(edge) for edge in graph_edges + path_edges))
        edge_by_id = {id(edge): edge for edge in graph_edges + path_edges}
        selected_edges = [edge_by_id[key] for key in traversed]
        retrieval_ms = max(0, round((time.perf_counter() - retrieval_started) * 1000, 2))
        facts = [f"{edge.source} -> {edge.relation} -> {edge.target}" for edge in selected_edges]
        answer = self._synthesize(question, [chunk for _, chunk in top], facts, matched, path_edges)
        synthesis_ms = max(0, round((time.perf_counter() - started) * 1000, 2) - route_ms - retrieval_ms)
        chunks = [{"id": chunk.chunk_id, "source": chunk.source, "text": chunk.text,
                   "score": round(score, 4)} for score, chunk in top]
        trace = [
            {"agent": "Router", "status": "done",
             "detail": f"Selected {route['strategy']} with confidence {route['confidence']:.2f}; features {route['features']}",
             "ms": route_ms, "strategy": route["strategy"], "confidence": route["confidence"]},
            {"agent": "Extractor / Retriever", "status": "done",
             "detail": f"TF-IDF cosine top scores {[round(score, 4) for score, _ in top]}; BFS reached {len(graph_nodes)} nodes and {len(selected_edges)} triplets. Cypher: {self.graph.cypher_for(selected_edges) or '(no traversal)'}",
             "ms": retrieval_ms},
            {"agent": "Synthesizer", "status": "done",
             "detail": f"Grounded synthesis from {len(top)} source chunks and {len(facts)} verified triplets.",
             "ms": synthesis_ms},
        ]
        return {
            "answer": answer, "hops": 2 if graph_edges else 1, "chunks_used": len(chunks),
            "graph_facts_used": len(facts), "strategy": route["strategy"], "confidence": route["confidence"],
            "trace": trace, "highlighted_nodes": graph_nodes, "highlighted_edges": [
                {"source": edge.source, "target": edge.target, "relation": edge.relation}
                for edge in selected_edges],
            "source_chunks": chunks, "graph_facts": facts, "features": route["features"],
        }

    @staticmethod
    def _synthesize(question: str, chunks: list[Chunk], facts: list[str],
                    entities: list[str], path: list[Edge]) -> str:
        lines = []
        if facts:
            lines.append("Verified graph relationships: " + "; ".join(facts[:6]) + ".")
        if path and entities:
            current = entities[0]
            chain = current
            for edge in path:
                if edge.source == current:
                    chain += f" -[{edge.relation}]-> {edge.target}"
                    current = edge.target
                elif edge.target == current:
                    chain += f" <-[{edge.relation}]- {edge.source}"
                    current = edge.source
                else:
                    chain += f" -[{edge.relation}]-> {edge.target}"
                    current = edge.target
            lines.append(f"Shortest path: {chain}.")
        query_terms = set(tokenize(question))
        evidence = []
        for chunk in chunks:
            for sentence in sentence_split(chunk.text):
                overlap = query_terms.intersection(tokenize(sentence))
                if overlap:
                    evidence.append((len(overlap), sentence, chunk.chunk_id))
        evidence.sort(key=lambda item: item[0], reverse=True)
        seen = set()
        for _, sentence, chunk_id in evidence[:3]:
            normalized = sentence.lower()
            if normalized not in seen:
                lines.append(f"{sentence} [{chunk_id}]")
                seen.add(normalized)
        if not lines:
            return "I couldn't find a grounded answer in the ingested documents for that question."
        return " ".join(lines)

    def graph_payload(self) -> dict:
        ranks = self.graph.pagerank()
        return {
            "nodes": [{"id": name, "label": name, "type": entity.entity_type,
                       "degree": self.graph.degree(name), "in_degree": len(self.graph.incoming[name]),
                       "out_degree": len(self.graph.outgoing[name]), "pagerank": round(ranks.get(name, 0), 6)}
                      for name, entity in self.graph.nodes.items()],
            "links": [{"source": edge.source, "target": edge.target, "relation": edge.relation,
                       "chunk_id": edge.chunk_id} for edge in self.graph.edges],
        }


class ScratchAnswerEngine:
    """Compatibility facade for callers that only need cited chunk ranking."""

    def __init__(self) -> None:
        self.chunks: list[Chunk] = []

    def load(self, chunks) -> None:
        self.chunks = list(chunks)

    def answer(self, question: str, chunks, graph_facts: list[str], max_sentences: int = 3) -> str:
        if not self.chunks:
            self.load(chunks)
        query_terms = set(tokenize(question))
        candidates = []
        for chunk in self.chunks:
            for sentence in sentence_split(chunk.text):
                overlap = query_terms.intersection(tokenize(sentence))
                if overlap:
                    candidates.append((len(overlap), sentence, chunk.chunk_id))
        candidates.sort(key=lambda item: item[0], reverse=True)
        answer = [f"{sentence} [{chunk_id}]" for _, sentence, chunk_id in candidates[:max_sentences]]
        answer.extend(graph_facts[:max(0, max_sentences - len(answer))])
        return " ".join(answer) if answer else "I couldn't find a grounded answer in the ingested documents for that question."
