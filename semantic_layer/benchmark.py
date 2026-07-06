from __future__ import annotations

import asyncio
import statistics
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from .config import ModelTier, SemanticLayerConfig
from .orchestrator import PipelineResult, SemanticOrchestrator
from .router import SemanticRouter


def _percentile(sorted_values: List[float], pct: float) -> float:
    """Linear-interpolation percentile on a pre-sorted list."""
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    k = (len(sorted_values) - 1) * pct
    f = int(k)
    c = min(f + 1, len(sorted_values) - 1)
    return sorted_values[f] + (k - f) * (sorted_values[c] - sorted_values[f])


@dataclass
class ResourceSnapshot:
    rss_mb: float = 0.0
    cpu_percent: float = 0.0


@dataclass
class BenchmarkReport:
    n: int
    cache_hit_rate: float
    semantic_p50_ms: float
    semantic_p95_ms: float
    semantic_p99_ms: float
    llm_p50_ms: float
    llm_p95_ms: float
    llm_p99_ms: float
    end_to_end_p50_ms: float
    end_to_end_p95_ms: float
    end_to_end_p99_ms: float
    embed_p50_ms: float
    cache_p50_ms: float
    route_p50_ms: float
    compress_p50_ms: float
    target_overhead_ms: float = 15.0
    meets_target: bool = False
    resource: ResourceSnapshot = field(default_factory=ResourceSnapshot)

    def summary(self) -> str:
        target_flag = "PASS" if self.meets_target else "FAIL"
        lines = [
            f"BenchmarkReport(n={self.n}, cache_hit_rate={self.cache_hit_rate:.1%})",
            f"  semantic: p50={self.semantic_p50_ms:.1f}ms "
            f"p95={self.semantic_p95_ms:.1f}ms p99={self.semantic_p99_ms:.1f}ms "
            f"(target p95<{self.target_overhead_ms:.0f}ms: {target_flag})",
            f"  llm:      p50={self.llm_p50_ms:.1f}ms "
            f"p95={self.llm_p95_ms:.1f}ms p99={self.llm_p99_ms:.1f}ms",
            f"  e2e:      p50={self.end_to_end_p50_ms:.1f}ms "
            f"p95={self.end_to_end_p95_ms:.1f}ms p99={self.end_to_end_p99_ms:.1f}ms",
            f"  stages:   embed_p50={self.embed_p50_ms:.1f}ms "
            f"cache_p50={self.cache_p50_ms:.1f}ms "
            f"route_p50={self.route_p50_ms:.1f}ms "
            f"compress_p50={self.compress_p50_ms:.1f}ms",
        ]
        if self.resource.rss_mb > 0:
            lines.append(
                f"  resource: rss={self.resource.rss_mb:.0f}MB "
                f"cpu={self.resource.cpu_percent:.0f}%"
            )
        return "\n".join(lines)


@dataclass
class RoutingEvalReport:
    """Accuracy of the router against a labeled tier set — a starting point for
    tuning `complexity_threshold` on real traffic rather than by feel."""

    n: int
    accuracy: float
    per_tier: Dict[str, Tuple[int, int]]  # tier -> (correct, total)
    confusions: List[Tuple[str, str, str]]  # (prompt, expected, predicted)

    def summary(self) -> str:
        lines = [f"RoutingEvalReport(n={self.n}, accuracy={self.accuracy:.1%})"]
        for tier, (correct, total) in sorted(self.per_tier.items()):
            rate = correct / total if total else 0.0
            lines.append(f"  {tier:<6} {correct}/{total} ({rate:.0%})")
        return "\n".join(lines)


def evaluate_routing(
    router: SemanticRouter,
    labeled: List[Tuple[str, ModelTier]],
) -> RoutingEvalReport:
    """Score router tier selection against `(prompt, expected_tier)` labels."""
    per_tier: Dict[str, List[int]] = {}
    confusions: List[Tuple[str, str, str]] = []
    correct = 0
    for prompt, expected in labeled:
        predicted = router.route(prompt).tier
        bucket = per_tier.setdefault(expected.value, [0, 0])
        bucket[1] += 1
        if predicted == expected:
            correct += 1
            bucket[0] += 1
        else:
            confusions.append((prompt, expected.value, predicted.value))
    return RoutingEvalReport(
        n=len(labeled),
        accuracy=correct / len(labeled) if labeled else 0.0,
        per_tier={k: (v[0], v[1]) for k, v in per_tier.items()},
        confusions=confusions,
    )


def _sample_resources() -> ResourceSnapshot:
    try:
        import psutil

        proc = psutil.Process()
        return ResourceSnapshot(
            rss_mb=proc.memory_info().rss / (1024 * 1024),
            cpu_percent=proc.cpu_percent(interval=0.05),
        )
    except ImportError:
        return ResourceSnapshot()


async def benchmark(
    pipeline: SemanticOrchestrator,
    queries: List[str],
    warmup: int = 3,
    rag_provider: Optional[Callable[[str], List[tuple[str, str]]]] = None,
) -> BenchmarkReport:
    """
    Run queries through the pipeline and collect latency percentiles.

    Args:
        pipeline: Configured orchestrator instance.
        queries: Prompts to benchmark.
        warmup: Number of leading queries used for embedder/FAISS warm-up.
        rag_provider: Optional callable returning RAG docs per query.
    """
    for q in queries[: min(warmup, len(queries))]:
        docs = rag_provider(q) if rag_provider else None
        await pipeline.run(q, rag_documents=docs)

    results: List[PipelineResult] = []
    for q in queries:
        docs = rag_provider(q) if rag_provider else None
        r = await pipeline.run(q, rag_documents=docs)
        results.append(r)

    semantic_latencies = [r.metrics.total_semantic_ms for r in results]
    llm_latencies = [r.metrics.llm_ms for r in results if not r.metrics.cache_hit]
    end_to_end = [
        r.metrics.total_semantic_ms + r.metrics.llm_ms for r in results
    ]
    embed_latencies = [r.metrics.embed_ms for r in results]
    cache_latencies = [r.metrics.cache_ms for r in results]
    route_latencies = [r.metrics.route_ms for r in results]
    compress_latencies = [r.metrics.compress_ms for r in results]
    hits = sum(1 for r in results if r.metrics.cache_hit)

    sorted_sem = sorted(semantic_latencies)
    sorted_llm = sorted(llm_latencies)
    sorted_e2e = sorted(end_to_end)
    target = pipeline.config.target_overhead_ms
    semantic_p95 = _percentile(sorted_sem, 0.95)

    return BenchmarkReport(
        n=len(results),
        cache_hit_rate=hits / len(results) if results else 0.0,
        semantic_p50_ms=_percentile(sorted_sem, 0.50),
        semantic_p95_ms=semantic_p95,
        semantic_p99_ms=_percentile(sorted_sem, 0.99),
        llm_p50_ms=_percentile(sorted_llm, 0.50),
        llm_p95_ms=_percentile(sorted_llm, 0.95),
        llm_p99_ms=_percentile(sorted_llm, 0.99),
        end_to_end_p50_ms=_percentile(sorted_e2e, 0.50),
        end_to_end_p95_ms=_percentile(sorted_e2e, 0.95),
        end_to_end_p99_ms=_percentile(sorted_e2e, 0.99),
        embed_p50_ms=statistics.median(embed_latencies) if embed_latencies else 0.0,
        cache_p50_ms=statistics.median(cache_latencies) if cache_latencies else 0.0,
        route_p50_ms=statistics.median(route_latencies) if route_latencies else 0.0,
        compress_p50_ms=statistics.median(compress_latencies) if compress_latencies else 0.0,
        target_overhead_ms=target,
        meets_target=semantic_p95 <= target,
        resource=_sample_resources(),
    )


def main() -> None:
    """CLI entry point for quick local benchmarking."""
    from .orchestrator import SemanticOrchestrator

    config = SemanticLayerConfig(embed_device="cpu")
    pipeline = SemanticOrchestrator(config)

    sample_queries = [
        "What is the capital of France?",
        "Tell me the capital city of France",
        "Define photosynthesis in one sentence",
        "Write a Python function to merge two sorted lists",
        "Compare microservices vs monolith architecture trade-offs",
    ]

    report = asyncio.run(benchmark(pipeline, sample_queries, warmup=1))
    print(report.summary())


if __name__ == "__main__":
    main()
