"""
Tests for the FastAPI web layer (src/app.py). Run offline against the
rule-based fallback LLM, same as tests/test_basic.py -- no API key needed.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from src.app import app


def test_health_reports_ok_after_startup():
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["graph_nodes"] > 0


def test_query_returns_grounded_answer():
    with TestClient(app) as client:
        response = client.post("/query", json={"question": "What is Self-Attention?"})
        assert response.status_code == 200
        body = response.json()
        assert "answer" in body and len(body["answer"]) > 0
        assert body["hops"] >= 1


def test_query_rejects_empty_question():
    with TestClient(app) as client:
        response = client.post("/query", json={"question": ""})
        assert response.status_code == 422  # pydantic min_length validation


def test_query_rejects_overly_long_question():
    with TestClient(app) as client:
        response = client.post("/query", json={"question": "x" * 5000})
        assert response.status_code == 422  # pydantic max_length validation


def test_index_page_serves_html():
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert "KnowledgeGraph AI" in response.text


def test_query_rate_limit_blocks_excess_requests(monkeypatch):
    from src.app import _request_log
    from src.config import settings

    _request_log.clear()
    object.__setattr__(settings, "rate_limit_per_minute", 2)
    with TestClient(app) as client:
        r1 = client.post("/query", json={"question": "What is Self-Attention?"})
        r2 = client.post("/query", json={"question": "What is Self-Attention?"})
        r3 = client.post("/query", json={"question": "What is Self-Attention?"})
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r3.status_code == 429
    object.__setattr__(settings, "rate_limit_per_minute", 20)
    _request_log.clear()


def test_api_key_required_when_configured(monkeypatch):
    from src.config import settings

    object.__setattr__(settings, "api_key", "secret123")
    with TestClient(app) as client:
        no_key = client.post("/query", json={"question": "What is Self-Attention?"})
        assert no_key.status_code == 401

        wrong_key = client.post("/query", json={"question": "What is Self-Attention?"}, headers={"X-API-Key": "wrong"})
        assert wrong_key.status_code == 401

        right_key = client.post("/query", json={"question": "What is Self-Attention?"}, headers={"X-API-Key": "secret123"})
        assert right_key.status_code == 200
    object.__setattr__(settings, "api_key", None)
