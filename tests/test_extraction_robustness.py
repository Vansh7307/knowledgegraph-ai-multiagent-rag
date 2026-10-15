import json
from pathlib import Path

from src.extraction_metrics import extraction_metrics

FIXTURE = Path(__file__).parent / "fixtures" / "extraction_gold_large.json"


def test_large_gold_extraction_benchmark_meets_macro_quality_gate():
    examples = json.loads(FIXTURE.read_text(encoding="utf-8"))
    metrics = extraction_metrics(FIXTURE)

    assert len(examples) == 100
    assert {"passive", "compound", "negation", "pronoun-abstention", "edge-case"} <= {
        example["category"] for example in examples
    }
    assert metrics["macro_precision"] >= 0.85, metrics
    assert metrics["macro_recall"] >= 0.85, metrics
    assert metrics["macro_f1"] >= 0.85, metrics
    assert 0.0 <= metrics["false_positive_rate"] <= 0.15, metrics
