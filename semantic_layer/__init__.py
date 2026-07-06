"""Semantic Layer — local LLM pipeline optimization (cache, route, compress)."""

from __future__ import annotations

from .benchmark import (
    BenchmarkReport,
    ResourceSnapshot,
    RoutingEvalReport,
    benchmark,
    evaluate_routing,
)
from .cache import CacheEntry, CacheLookupResult, SemanticCache, ThresholdCalibrator
from .compressor import CompressionResult, DocumentChunk, SemanticCompressor
from .config import ModelTier, SemanticLayerConfig
from .embedder import Embedder
from .ood import OODDetector
from .orchestrator import (
    PipelineMetrics,
    PipelineResult,
    SemanticOrchestrator,
    rag_fingerprint,
)
from .router import RouteDecision, SemanticRouter

__all__ = [
    "BenchmarkReport",
    "ResourceSnapshot",
    "RoutingEvalReport",
    "CacheEntry",
    "CacheLookupResult",
    "CompressionResult",
    "DocumentChunk",
    "Embedder",
    "ModelTier",
    "OODDetector",
    "PipelineMetrics",
    "PipelineResult",
    "RouteDecision",
    "SemanticCache",
    "SemanticCompressor",
    "SemanticLayerConfig",
    "SemanticOrchestrator",
    "SemanticRouter",
    "ThresholdCalibrator",
    "benchmark",
    "evaluate_routing",
    "rag_fingerprint",
]

__version__ = "1.0.0"
