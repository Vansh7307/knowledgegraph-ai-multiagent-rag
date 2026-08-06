"""
Tests for the from-scratch answer engine (src/scratch_engine.py) and its
integration into the offline LLM provider. Run fully offline, no API key.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.llm_provider import OfflineLLM
from src.scratch_engine import ScratchAnswerEngine, extract_entities_and_relations, sentence_split, tokenize
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
