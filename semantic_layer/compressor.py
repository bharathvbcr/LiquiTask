from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Tuple

import numpy as np
from numpy.typing import NDArray

from .config import SemanticLayerConfig
from .embedder import Embedder


@dataclass
class DocumentChunk:
    text: str
    source: str
    token_estimate: int
    relevance: float = 0.0


@dataclass
class CompressionResult:
    selected_chunks: List[DocumentChunk]
    total_tokens: int
    dropped_count: int
    compressed_context: str


class SemanticCompressor:
    """
    Filters and packs RAG chunks by semantic relevance to the query.
    Pipeline: chunk → embed → filter by threshold → greedy knapsack packing.
    """

    def __init__(self, config: SemanticLayerConfig, embedder: Embedder) -> None:
        self.config = config
        self.embedder = embedder

    def chunk_text(
        self,
        text: str,
        chunk_size: int | None = None,
        overlap: int | None = None,
    ) -> List[str]:
        """Split on paragraph boundaries first, then sub-split oversized chunks."""
        chunk_size = chunk_size or self.config.chunk_size
        overlap = overlap or self.config.chunk_overlap

        paragraphs = re.split(r"\n{2,}", text.strip())
        chunks: List[str] = []
        buffer = ""

        for para in paragraphs:
            if len(buffer) + len(para) < chunk_size:
                buffer = f"{buffer}\n\n{para}".strip()
            else:
                if buffer:
                    chunks.append(buffer)
                buffer = para
        if buffer:
            chunks.append(buffer)

        final: List[str] = []
        for c in chunks:
            if len(c) <= chunk_size:
                final.append(c)
            else:
                step = max(chunk_size - overlap, 1)
                for i in range(0, len(c), step):
                    final.append(c[i : i + chunk_size])
        return final

    def _estimate_tokens(self, text: str) -> int:
        return max(1, int(len(text) / self.config.avg_chars_per_token))

    def score_and_filter(
        self,
        query_emb: NDArray[np.float32],
        chunks: List[DocumentChunk],
    ) -> List[DocumentChunk]:
        if not chunks:
            return []

        texts = [c.text for c in chunks]
        chunk_embs = self.embedder.encode(texts)

        scored: List[DocumentChunk] = []
        for chunk, emb in zip(chunks, chunk_embs):
            relevance = float(np.dot(query_emb, emb))
            if relevance >= self.config.chunk_threshold:
                chunk.relevance = relevance
                scored.append(chunk)
        return scored

    def pack(self, chunks: List[DocumentChunk]) -> CompressionResult:
        """Greedy knapsack: sort by relevance-per-token ratio."""
        budget = self.config.max_context_tokens
        sorted_chunks = sorted(
            chunks,
            key=lambda c: c.relevance / max(c.token_estimate, 1),
            reverse=True,
        )

        selected: List[DocumentChunk] = []
        used_tokens = 0
        for chunk in sorted_chunks:
            if used_tokens + chunk.token_estimate <= budget:
                selected.append(chunk)
                used_tokens += chunk.token_estimate

        context = "\n\n---\n\n".join(f"[{c.source}]\n{c.text}" for c in selected)
        return CompressionResult(
            selected_chunks=selected,
            total_tokens=used_tokens,
            dropped_count=len(chunks) - len(selected),
            compressed_context=context,
        )

    def compress(
        self,
        query: str,
        documents: List[Tuple[str, str]],
    ) -> CompressionResult:
        """Full pipeline: chunk → embed → filter → pack."""
        query_emb = self.embedder.encode_one(query)
        all_chunks: List[DocumentChunk] = []

        for source, text in documents:
            for chunk_text in self.chunk_text(text):
                all_chunks.append(
                    DocumentChunk(
                        text=chunk_text,
                        source=source,
                        token_estimate=self._estimate_tokens(chunk_text),
                    )
                )

        if not all_chunks:
            return CompressionResult(
                selected_chunks=[],
                total_tokens=0,
                dropped_count=0,
                compressed_context="",
            )

        filtered = self.score_and_filter(query_emb, all_chunks)
        return self.pack(filtered)
