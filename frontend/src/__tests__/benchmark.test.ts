import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { ScratchGraphRAG, type TextChunk } from "../lib/scratchEngine";

export function runBenchmarkTest(): void {
  const corpus: TextChunk[] = Array.from({ length: 100 }, (_, index) => ({
    chunk_id: `benchmark-${index}`,
    source: "benchmark.txt",
    text: `Router uses BFS. GraphRAG supports Vector Search. Section ${index} describes PageRank.`,
  }));
  const engine = new ScratchGraphRAG();
  const ingestionStart = performance.now();
  engine.ingest(corpus);
  const ingestionMs = performance.now() - ingestionStart;
  assert.equal(engine.chunkCount, corpus.length);
  assert.ok(ingestionMs > 0);

  const queries = [
    ["How is Router connected to BFS?", "graph"],
    ["What is GraphRAG?", "text"],
    ["Explain how Router uses BFS and GraphRAG supports Vector Search.", "hybrid"],
  ] as const;
  const report = queries.map(([question, strategy]) => {
    const samples = Array.from({ length: 30 }, () => {
      const started = performance.now();
      const result = engine.query(question);
      return { elapsedMs: performance.now() - started, result };
    });
    const sorted = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
    assert.ok(samples.every(({ result }) => result.strategy === strategy));
    assert.ok(sorted[Math.ceil(sorted.length * 0.95) - 1] < 10, `${strategy} query p95 exceeded 10ms`);
  });
  assert.equal(report.length, 3);
}
