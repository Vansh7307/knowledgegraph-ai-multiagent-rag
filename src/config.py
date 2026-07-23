"""
Central configuration for the KnowledgeGraph AI Multi-Agent RAG System.

All values are read from environment variables so the system runs
identically from the CLI, the notebook, or a deployed service. Nothing
here requires a paid API key -- if no provider key is found the system
automatically falls back to a fully offline mode (see llm_provider.py).
"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    # -- Data & chunking -----------------------------------------------
    data_dir: str = os.getenv("KG_DATA_DIR", "data/sample_docs")
    chunk_size_words: int = int(os.getenv("KG_CHUNK_SIZE", "120"))
    chunk_overlap_words: int = int(os.getenv("KG_CHUNK_OVERLAP", "20"))

    # -- Retrieval -------------------------------------------------------
    top_k_chunks: int = int(os.getenv("KG_TOP_K", "4"))
    graph_hops: int = int(os.getenv("KG_GRAPH_HOPS", "2"))

    # -- Graph cache (avoids re-extracting entities via LLM on every restart) --
    graph_cache_path: str = os.getenv("KG_CACHE_PATH", ".cache/knowledge_graph.json")

    # -- Optional API protection (both off/generous by default) ---------
    api_key: str | None = os.getenv("API_KEY")  # if unset, /query needs no auth
    rate_limit_per_minute: int = int(os.getenv("KG_RATE_LIMIT_PER_MINUTE", "20"))

    # -- Multi-agent control loop ----------------------------------------
    max_reasoning_hops: int = int(os.getenv("KG_MAX_REASONING_HOPS", "2"))

    # -- LLM provider keys (all optional; first one found wins) ---------
    groq_api_key: str | None = os.getenv("GROQ_API_KEY")
    google_api_key: str | None = os.getenv("GOOGLE_API_KEY")
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    ollama_host: str | None = os.getenv("OLLAMA_HOST", "http://localhost:11434")

    groq_model: str = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3.1")


settings = Settings()
