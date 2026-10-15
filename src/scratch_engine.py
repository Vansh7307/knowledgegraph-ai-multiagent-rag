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
    "enables": "ENABLES", "supports": "SUPPORTS",
}
PREDICATE_PATTERNS = (
    (re.compile(r"\b(?:built\s+on|based\s+on)\b", re.I), "BUILT_ON"),
    (re.compile(r"\b(?:uses?|used|using|utilizes?|utilized|utilizing)\b", re.I), "USES"),
    (re.compile(r"\borchestrates?\b", re.I), "ORCHESTRATES"),
    (re.compile(r"\b(?:writes?|written|stores?|stored|persists?|persisted)\b", re.I), "WRITES_TO"),
    (re.compile(r"\b(?:computes?|computed|calculates?|calculated|ranks?|ranked)\b", re.I), "COMPUTES"),
    (re.compile(r"\b(?:parses?|parsed)\b", re.I), "EXTRACTS"),
    (re.compile(r"\b(?:traverses?|traversed)\b", re.I), "TRAVERSES"),
    (re.compile(r"\b(?:routes?|routed)(?:\s+to)?\b", re.I), "ROUTES_TO"),
    (re.compile(r"\b(?:powers?|powered(?:\s+by)?)\b", re.I), "POWERS"),
    (re.compile(r"\b(?:prevents?|prevented)\b", re.I), "PREVENTS"),
    (re.compile(r"\b(?:connects?|connected|links?|linked)\b", re.I), "CONNECTS_TO"),
    (re.compile(r"\b(?:retrieves?|retrieved)\b", re.I), "RETRIEVES"),
    (re.compile(r"\b(?:extracts?|extracted)\b", re.I), "EXTRACTS"),
    (re.compile(r"\b(?:contains?|contained)\b", re.I), "CONTAINS"),
    (re.compile(r"\b(?:combines?|combined)\b", re.I), "COMBINES"),
    (re.compile(r"\b(?:creates?|created)\b", re.I), "CREATES"),
    (re.compile(r"\b(?:generates?|generated)\b", re.I), "GENERATES"),
    (re.compile(r"\b(?:enables?|enabled)\b", re.I), "ENABLES"),
    (re.compile(r"\b(?:supports?|supported)\b", re.I), "SUPPORTS"),
)
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
    "Graph": "Database", "Text": "Concept", "Triplet": "Concept",
    "Cypher": "Concept",
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
        queue = start_nodes[:]
        depths = [0] * len(queue)
        found: list[Edge] = []
        cursor = 0
        if max_hops >= len(self.nodes):
            while cursor < len(queue):
                node = queue[cursor]
                cursor += 1
                for edge in self.outgoing[node]:
                    found.append(edge)
                    other = edge.target
                    if other not in reached:
                        reached.add(other)
                        queue.append(other)
            return queue, found
        while cursor < len(queue):
            node = queue[cursor]
            depth = depths[cursor]
            cursor += 1
            if depth >= max_hops:
                continue
            for edge in self.outgoing[node]:
                found.append(edge)
                other = edge.target
                if other not in reached:
                    reached.add(other)
                    queue.append(other)
                    depths.append(depth + 1)
        return queue, found

    def shortest_path(self, source: str, target: str) -> list[Edge]:
        if source not in self.nodes or target not in self.nodes:
            return []
        queue = deque([source])
        parent: dict[str, tuple[str, Edge] | None] = {source: None}
        while queue:
            node = queue.popleft()
            if node == target:
                break
            for edge in self.outgoing[node]:
                other = edge.target
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
        inherited_subject = None
        clauses = re.split(r",\s*(?:and\s+)?|\s+and\s+|\s+while\s+", sentence, flags=re.I)
        for clause in clauses:
            spans = []
            for name in entities:
                entity_match = re.search(rf"(?<!\w){re.escape(name)}(?!\w)", clause, re.I)
                if entity_match:
                    spans.append((entity_match.start(), entity_match.end(), name))
            spans = [entry for entry in spans if not any(
                other[0] <= entry[0] and entry[1] <= other[1] and len(other[2]) > len(entry[2])
                for other in spans)]
            present = [entry[2] for entry in sorted(spans, key=lambda entry: entry[0])]
            if len(present) < 2 and not inherited_subject:
                continue
            match = next(((predicate_match, predicate) for pattern, predicate in PREDICATE_PATTERNS
                          if (predicate_match := pattern.search(clause))), None)
            if not match:
                continue
            predicate_match, relation = match
            if re.search(r"\b(?:not|never|no)\b", clause, re.I):
                continue
            passive = re.search(
                r"\b(?:is|are|was|were|been|being)\s+(?:used|utilized|orchestrated|written|stored|persisted|"
                r"computed|calculated|ranked|routed|powered|prevented|connected|linked|retrieved|extracted|"
                r"contained|combined|created|generated|enabled|supported|traversed|parsed)\s+by\b",
                clause, re.I)
            if passive:
                patients = [entry for entry in spans if entry[1] <= passive.start()]
                actors = [entry for entry in spans if entry[0] >= passive.end()]
                if not patients or not actors:
                    continue
                obj = max(patients, key=lambda entry: entry[0])[2]
                subject = min(actors, key=lambda entry: entry[0])[2]
            else:
                before = [entry for entry in spans if entry[1] <= predicate_match.start()]
                after = [entry for entry in spans if entry[0] >= predicate_match.end()]
                if not after:
                    continue
                subject = max(before, key=lambda entry: entry[0])[2] if before else inherited_subject
                if not subject:
                    continue
                obj = min(after, key=lambda entry: entry[0])[2]
            if subject != obj:
                relations.append({"source": subject, "target": obj, "relation": relation, "text": sentence})
                inherited_subject = subject
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
            idf = math.log((1 + n_docs) / (1 + self.document_frequency[term])) + 1.0 if n_docs else 0.0
            query_vector[term] = (count / max(1, len(tokenize(query)))) * idf
        query_norm = math.sqrt(sum(value * value for value in query_vector.values()))
        results = []
        for chunk, tokens in zip(self.chunks, self.tokens):
            counts = Counter(tokens)
            vector = {}
            for term in query_counts:
                idf = math.log((1 + n_docs) / (1 + self.document_frequency[term])) + 1.0 if n_docs else 0.0
                vector[term] = (counts[term] / max(1, len(tokens))) * idf
            norm = math.sqrt(sum(value * value for value in vector.values()))
            dot = sum(query_vector[t] * vector[t] for t in query_vector)
            similarity = dot / (query_norm * norm) if query_norm and norm else 0.0
            results.append((similarity, chunk))
        return sorted(results, key=lambda pair: pair[0], reverse=True)


def route_query(question: str, graph: PropertyGraph) -> dict:
    tokens = tokenize(question)
    relational = len(re.findall(
        r"\b(?:connect(?:s|ed|ing|ion)?|relationship|relate(?:s|d|ion)?|between|path|"
        r"link(?:s|ed|ing)?|route(?:s|d|ing)?)\b", question.lower()))
    interrogative = int(bool(re.match(r"\s*(how|why|which|what|who|where|when)\b", question, re.I)))
    matched = [name for name in graph.nodes if re.search(rf"(?<!\w){re.escape(name)}(?!\w)", question, re.I)]
    matched.sort(key=lambda name: question.lower().find(name.lower()))
    density = min(1.0, len(matched) / max(1, len(tokens)))
    if relational and len(matched) >= 2:
        strategy = "graph"
    elif interrogative and len(tokens) <= 8 and not relational:
        strategy = "text"
    else:
        strategy = "hybrid"
    confidence_breakdown = {
        "baseline": 0.45,
        "relational": 0.15 * bool(relational),
        "interrogative": 0.12 * interrogative,
        "entity_density": 0.2 * density,
    }
    confidence = min(1.0, sum(confidence_breakdown.values()))
    return {
        "strategy": strategy, "confidence": round(confidence, 2),
        "confidence_breakdown": confidence_breakdown,
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

    def reset(self) -> None:
        self.graph = PropertyGraph()
        self.chunks.clear()
        self._chunk_ids.clear()

    def query(self, question: str) -> dict:
        started = time.perf_counter()
        route_started = time.perf_counter()
        route = route_query(question, self.graph)
        route_ms = max(0, round((time.perf_counter() - route_started) * 1000, 2))
        matched = route["features"]["matched_entities"]
        retrieval_started = time.perf_counter()
        scores = TFIDF(self.chunks).score(question) if route["strategy"] != "graph" else []
        top = [(score, chunk) for score, chunk in scores if score > 0][:4]
        graph_nodes, graph_edges = (
            self.graph.bfs(matched, 2)
            if matched and route["strategy"] != "text" else ([], [])
        )
        path_edges = []
        if len(matched) >= 2 and route["strategy"] != "text":
            path_edges = self.graph.shortest_path(matched[0], matched[1])
        traversed = list(dict.fromkeys(id(edge) for edge in graph_edges + path_edges))
        edge_by_id = {id(edge): edge for edge in graph_edges + path_edges}
        selected_edges = [edge_by_id[key] for key in traversed]
        retrieval_ms = max(0, round((time.perf_counter() - retrieval_started) * 1000, 2))
        facts = [f"{edge.source} -> {edge.relation} -> {edge.target} [{edge.chunk_id}]"
                 for edge in selected_edges]
        answer = self._synthesize(
            question, [chunk for _, chunk in top], facts,
            matched if route["strategy"] != "text" else [], path_edges)
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
             "detail": f"Extractive synthesis from {len(top)} source chunks and {len(facts)} heuristic graph triplets.",
             "ms": synthesis_ms},
        ]
        return {
            "answer": answer, "hops": len(path_edges),
            "chunks_used": len(chunks),
            "graph_facts_used": len(facts), "strategy": route["strategy"], "confidence": route["confidence"],
            "confidence_breakdown": route["confidence_breakdown"],
            "path_nodes": [matched[0], *[edge.target for edge in path_edges]] if path_edges else [],
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
            lines.append("Heuristically extracted graph relationships: " + "; ".join(facts[:6]) + ".")
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
        elif len(entities) >= 2:
            lines.append(f"No directed path was found from {entities[0]} to {entities[1]} in the extracted graph.")
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
