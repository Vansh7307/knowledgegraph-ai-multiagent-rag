"""
graph_orchestrator.py
----------------------
Wires the Retrieval Agent, Reasoning Agent, and Synthesis Agent together
into a LangGraph state machine. The Reasoning Agent can send the flow
back to Retrieval for another hop (bounded by `max_reasoning_hops`),
which is what lets this system answer multi-hop questions such as
"Which company built the model that OpenAI's GPT decoder descended from?"
"""

from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, StateGraph

from src.agents import ReasoningAgent, SynthesisAgent
from src.config import settings
from src.knowledge_graph import facts_for_entities
from src.retriever import HybridRetriever


class QueryState(TypedDict, total=False):
    question: str
    hop: int
    chunks: list
    graph_facts: list[str]
    entities: list[str]
    sufficient: bool
    answer: str


def build_query_graph(retriever: HybridRetriever, kg, known_entities: list[str]):
    reasoning_agent = ReasoningAgent()
    synthesis_agent = SynthesisAgent()

    def retrieve_node(state: QueryState) -> QueryState:
        question = state["question"]
        new_chunks = retriever.top_chunks(question, settings.top_k_chunks)
        matched = retriever.match_entities(question, known_entities)
        entities = list(dict.fromkeys(state.get("entities", []) + matched))
        graph_facts = facts_for_entities(kg, entities, hops=settings.graph_hops)

        existing_ids = {c.chunk_id for c in state.get("chunks", [])}
        merged_chunks = state.get("chunks", []) + [c for c in new_chunks if c.chunk_id not in existing_ids]

        return {**state, "chunks": merged_chunks, "graph_facts": graph_facts, "entities": entities}

    def reason_node(state: QueryState) -> QueryState:
        chunk_texts = [f"[{c.chunk_id}] {c.text}" for c in state.get("chunks", [])]
        verdict = reasoning_agent.evaluate(state["question"], chunk_texts, state.get("graph_facts", []))
        missing = verdict.get("missing_entities", []) or []
        entities = list(dict.fromkeys(state.get("entities", []) + missing))
        hop = state.get("hop", 0) + 1
        return {**state, "sufficient": bool(verdict.get("sufficient", True)), "entities": entities, "hop": hop}

    def synthesize_node(state: QueryState) -> QueryState:
        answer = synthesis_agent.answer(state["question"], state.get("chunks", []), state.get("graph_facts", []))
        return {**state, "answer": answer}

    def route_after_reasoning(state: QueryState) -> str:
        if state.get("sufficient", True) or state.get("hop", 0) >= settings.max_reasoning_hops:
            return "synthesize"
        return "retrieve"

    workflow = StateGraph(QueryState)
    workflow.add_node("retrieve", retrieve_node)
    workflow.add_node("reason", reason_node)
    workflow.add_node("synthesize", synthesize_node)

    workflow.set_entry_point("retrieve")
    workflow.add_edge("retrieve", "reason")
    workflow.add_conditional_edges("reason", route_after_reasoning, {"retrieve": "retrieve", "synthesize": "synthesize"})
    workflow.add_edge("synthesize", END)

    return workflow.compile()
