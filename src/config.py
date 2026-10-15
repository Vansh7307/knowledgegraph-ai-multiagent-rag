"""Configuration for local document processing and optional app protection."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    data_dir: str = os.getenv("KG_DATA_DIR", "data/sample_docs")
    chunk_size_words: int = int(os.getenv("KG_CHUNK_SIZE", "120"))
    chunk_overlap_words: int = int(os.getenv("KG_CHUNK_OVERLAP", "20"))
    top_k_chunks: int = int(os.getenv("KG_TOP_K", "4"))
    graph_hops: int = int(os.getenv("KG_GRAPH_HOPS", "2"))
    api_key: str | None = os.getenv("API_KEY")
    rate_limit_per_minute: int = int(os.getenv("KG_RATE_LIMIT_PER_MINUTE", "20"))
    max_reasoning_hops: int = int(os.getenv("KG_MAX_REASONING_HOPS", "2"))


settings = Settings()
