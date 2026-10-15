"""
text_utils.py
-------------
Document loading (TXT + PDF via PyMuPDF) and semantic chunking
via LangChain's RecursiveCharacterTextSplitter.
"""

from __future__ import annotations

import glob
import os
from dataclasses import dataclass


@dataclass
class Chunk:
    chunk_id: str
    source: str
    text: str


def _extract_pdf_text_from_bytes(data: bytes) -> str:
    """Extract text from PDF bytes in-memory (no temp file). Falls back to empty string."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=data, filetype="pdf")
        return "\n".join(page.get_text() for page in doc)
    except Exception:
        return ""


def _extract_pdf_text(path: str) -> str:
    """Extract text from a PDF file path. Used only for startup corpus loading."""
    try:
        with open(path, "rb") as f:
            return _extract_pdf_text_from_bytes(f.read())
    except Exception:
        return ""


def load_documents(data_dir: str) -> dict[str, str]:
    """Load .txt and .pdf files from data_dir as {filename: raw_text}."""
    docs = {}
    for pattern in ("*.txt", "*.pdf"):
        for path in sorted(glob.glob(os.path.join(data_dir, pattern))):
            name = os.path.basename(path)
            if path.endswith(".pdf"):
                docs[name] = _extract_pdf_text(path)
            else:
                with open(path, "r", encoding="utf-8") as f:
                    docs[name] = f.read()
    return docs


def extract_upload_text(filename: str, contents: bytes) -> str:
    """Extract text from uploaded file bytes — no disk I/O."""
    if filename.endswith(".pdf"):
        return _extract_pdf_text_from_bytes(contents)
    return contents.decode("utf-8", errors="replace")


def chunk_text(
    text: str,
    source: str,
    chunk_size: int = 500,
    chunk_overlap: int = 50,
    *,
    size_words: int | None = None,
    overlap_words: int | None = None,
) -> list[Chunk]:
    """Semantic chunking via RecursiveCharacterTextSplitter (character-based)."""
    if size_words is not None:
        chunk_size = size_words * 5
    if overlap_words is not None:
        chunk_overlap = overlap_words * 5

    try:
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        splits = splitter.split_text(text)
    except Exception:
        # Fallback: naive word-window chunking
        words = text.split()
        step = max(chunk_size // 5 - chunk_overlap // 5, 1)
        splits = [
            " ".join(words[s:s + chunk_size // 5])
            for s in range(0, len(words), step)
            if words[s:s + chunk_size // 5]
        ]
    return [
        Chunk(chunk_id=f"{source}::chunk{i}", source=source, text=t)
        for i, t in enumerate(splits) if t.strip()
    ]


def build_all_chunks(data_dir: str, size_words: int = 500, overlap_words: int = 50) -> list[Chunk]:
    docs = load_documents(data_dir)
    all_chunks: list[Chunk] = []
    for source, text in docs.items():
        all_chunks.extend(chunk_text(text, source, size_words * 5, overlap_words * 5))
    return all_chunks
