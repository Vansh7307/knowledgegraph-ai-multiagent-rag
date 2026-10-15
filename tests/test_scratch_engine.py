"""
Tests for the from-scratch answer engine (src/scratch_engine.py) and its
integration into the offline LLM provider. Run fully offline, no API key.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.llm_provider import OfflineLLM
from src.scratch_engine import (
    Chunk as EngineChunk,
    GraphRAGEngine,
    PropertyGraph,
    ScratchAnswerEngine,
    TFIDF,
    extract_entities_and_relations,
    route_query,
    sentence_split,
    tokenize,
)
from src.text_utils import Chunk


def _chunks():
    return [
        Chunk(
            chunk_id="doc.txt::chunk0",
            source="doc.txt",
            text=(
                "The Transformer architecture was introduced by Google in 2017. "
                "BERT is a bidirectional model built on top of the Transformer. "
                "Retrieval-Augmented Generation combines search with generation."
            ),
        ),
        Chunk(
            chunk_id="doc.txt::chunk1",
            source="doc.txt",
            text=(
                "Self-Attention lets each token attend to every other token. "
                "This is what gives Transformers their parallel processing power."
            ),
        ),
    ]


def test_tokenize_removes_stopwords():
    tokens = tokenize("How does the Transformer work?")
    assert "the" not in tokens
    assert "transformer" in tokens
    assert "work" in tokens


def test_sentence_split():
    sents = sentence_split("First sentence here. Second one! Third?")
    assert len(sents) == 3
    assert sents[0] == "First sentence here."


def test_extract_entities_and_relations_shape():
    out = extract_entities_and_relations("OpenAI built ChatGPT using the Transformer architecture.")
    assert isinstance(out["entities"], list) and len(out["entities"]) > 0
    assert isinstance(out["relations"], list)
    assert all("source" in r and "target" in r for r in out["relations"])


def test_scratch_engine_returns_grounded_cited_answer():
    engine = ScratchAnswerEngine()
    answer = engine.answer("What is BERT based on?", _chunks(), graph_facts=[])
    assert "Transformer" in answer
    assert "doc.txt::chunk0" in answer  # citation present


def test_scratch_engine_returns_no_answer_when_unrelated():
    engine = ScratchAnswerEngine()
    answer = engine.answer("What is the capital of Atlantis?", _chunks(), graph_facts=[])
    assert "couldn't" in answer.lower() or "grounded" in answer.lower()


def test_offline_llm_answers_via_scratch_engine():
    llm = OfflineLLM()
    user_prompt = (
        "Context:\n[doc.txt::chunk0] The Transformer architecture was introduced by Google. "
        "BERT is built on the Transformer.\n\n"
        "Graph facts:\n(none)\n\n"
        "Question: What is BERT built on?"
    )
    answer = llm.chat("You are the Synthesis Agent.", user_prompt)
    assert "Transformer" in answer
    assert "doc.txt::chunk0" in answer


def test_offline_llm_extracts_entities():
    llm = OfflineLLM()
    raw = llm.chat("Return ONLY a JSON list of entities", "OpenAI released ChatGPT.")
    import json

    parsed = json.loads(raw)
    assert "OpenAI" in parsed["entities"]


def test_property_graph_keeps_reverse_adjacency_and_shortest_path():
    graph = PropertyGraph()
    graph.add_edge("Extractor", "Property Graph", "WRITES_TO", "a::chunk0", "Extractor writes to Property Graph.")
    graph.add_edge("Property Graph", "PageRank", "COMPUTES", "b::chunk0", "Property Graph computes PageRank.")

    nodes, edges = graph.bfs(["Extractor"], max_hops=2)

    assert set(nodes) == {"Extractor", "Property Graph", "PageRank"}
    assert len(edges) == 2
    assert graph.incoming["Property Graph"][0].source == "Extractor"
    assert graph.shortest_path("Extractor", "PageRank") == edges
    assert graph.number_of_nodes() == 3
    assert graph.number_of_edges() == 2


def test_directed_traversal_never_follows_an_incoming_edge_backwards():
    graph = PropertyGraph()
    graph.add_edge("Source", "Target", "USES", "a::chunk0", "Source uses Target.")

    assert graph.bfs(["Target"], max_hops=2) == (["Target"], [])
    assert graph.shortest_path("Target", "Source") == []
    assert graph.shortest_path("Source", "Target")[0].source == "Source"


def test_extractor_detects_typed_entities_and_verb_relationships():
    result = extract_entities_and_relations(
        "The Router routes a query to the Knowledge Graph. PageRank computes centrality."
    )
    typed = {entity["name"]: entity["type"] for entity in result["typed_entities"]}
    relations = {(item["source"], item["target"], item["relation"]) for item in result["relations"]}

    assert typed["Router"] == "Agent"
    assert typed["Knowledge Graph"] == "Database"
    assert ("Router", "Knowledge Graph", "ROUTES_TO") in relations


def test_tfidf_cosine_and_router_confidence_are_local_and_bounded():
    chunks = [
        EngineChunk("a::chunk0", "a", "Self-Attention computes token relationships. Self-Attention connects PageRank."),
        EngineChunk("b::chunk0", "b", "PageRank computes graph centrality."),
        EngineChunk("c::chunk0", "c", "SQLite stores local metadata."),
    ]
    ranked = TFIDF(chunks).score("Self-Attention")
    graph = GraphRAGEngine()
    graph.ingest(chunks)
    route = route_query("How does Self-Attention connect to PageRank?", graph.graph)

    assert ranked[0][1].chunk_id == "a::chunk0"
    assert 0.0 <= route["confidence"] <= 1.0
    assert route["strategy"] == "graph"
    assert route_query("How are Self-Attention and PageRank connected?", graph.graph)["strategy"] == "graph"
    result = graph.query("How does Self-Attention connect to PageRank?")
    assert "MATCH (s)-[r:" in result["trace"][1]["detail"]
    assert all(step["ms"] >= 0 for step in result["trace"])


def test_smoothed_tfidf_scores_rare_and_common_terms_without_zero_or_negative_idf():
    chunks = [
        EngineChunk("a", "a", "common rare"),
        EngineChunk("b", "b", "common other"),
    ]

    rare = TFIDF(chunks).score("rare")
    common = TFIDF(chunks).score("common")
    one_document = TFIDF(chunks[:1]).score("common")

    assert rare[0][0] > 0 and rare[0][1].chunk_id == "a"
    assert common[0][0] > 0
    assert one_document[0][0] == 1


def test_extractor_abstains_without_predicate_and_for_negated_relationships():
    no_predicate = extract_entities_and_relations("The Router and Knowledge Graph are available.")
    negated = extract_entities_and_relations("The Router does not use the Knowledge Graph.")

    assert no_predicate["relations"] == []
    assert negated["relations"] == []


def test_extractor_resolves_active_and_passive_predicate_direction():
    active = extract_entities_and_relations("The Router uses the Knowledge Graph.")
    passive = extract_entities_and_relations("The Knowledge Graph is used by the Router.")

    assert [(item["source"], item["target"], item["relation"]) for item in active["relations"]] == [
        ("Router", "Knowledge Graph", "USES")]
    assert [(item["source"], item["target"], item["relation"]) for item in passive["relations"]] == [
        ("Router", "Knowledge Graph", "USES")]


def test_extractor_does_not_join_entities_across_coordinated_clauses():
    result = extract_entities_and_relations(
        "The Extractor extracts entities, the Router routes queries, and the Synthesizer combines evidence."
    )

    assert result["relations"] == []


def test_graph_answer_reports_absence_of_a_directed_connection():
    engine = GraphRAGEngine()
    engine.ingest([
        EngineChunk("a", "a", "The Router routes queries to Vector Search."),
        EngineChunk("b", "b", "The Knowledge Graph contains data."),
    ])

    result = engine.query("How are Router and Knowledge Graph connected?")

    assert result["strategy"] == "graph"
    assert result["hops"] == 1
    assert "No directed path was found from Router to Knowledge Graph" in result["answer"]
