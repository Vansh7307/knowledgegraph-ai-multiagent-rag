"""Small, dependency-free text utilities: loading + sliding-window chunking."""

from __future__ import annotations

import glob
import os
from dataclasses import dataclass


@dataclass
class Chunk:
    chunk_id: str
    source: str
    text: str


def load_documents(data_dir: str) -> dict[str, str]:
    """Load every .txt file in data_dir as {filename: raw_text}."""
    docs = {}
    for path in sorted(glob.glob(os.path.join(data_dir, "*.txt"))):
        with open(path, "r", encoding="utf-8") as f:
            docs[os.path.basename(path)] = f.read()
    return docs


def chunk_text(text: str, source: str, size_words: int, overlap_words: int) -> list[Chunk]:
    """Sliding-window word chunking, with a stable id per chunk for citations."""
    words = text.split()
    chunks: list[Chunk] = []
    step = max(size_words - overlap_words, 1)
    idx = 0
    for i, start in enumerate(range(0, len(words), step)):
        window = words[start:start + size_words]
        if not window:
            continue
        chunk_text_value = " ".join(window)
        chunks.append(Chunk(chunk_id=f"{source}::chunk{i}", source=source, text=chunk_text_value))
        idx = start
        if start + size_words >= len(words):
            break
    return chunks


def build_all_chunks(data_dir: str, size_words: int, overlap_words: int) -> list[Chunk]:
    docs = load_documents(data_dir)
    all_chunks: list[Chunk] = []
    for source, text in docs.items():
        all_chunks.extend(chunk_text(text, source, size_words, overlap_words))
    return all_chunks
