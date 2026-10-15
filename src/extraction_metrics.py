import json
import logging
from pathlib import Path

from src.scratch_engine import extract_entities_and_relations

GOLD_PATH = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "extraction_gold.json"
logger = logging.getLogger(__name__)


def extraction_metrics(fixture_path: Path = GOLD_PATH) -> dict:
    examples = json.loads(fixture_path.read_text(encoding="utf-8"))
    totals = {"true_positives": 0, "false_positives": 0, "false_negatives": 0}
    macro = {"precision": [], "recall": [], "f1": []}
    negative_examples = 0
    false_positive_examples = 0
    for example in examples:
        expected = {tuple(relation) for relation in example["relations"]}
        predicted = {
            (relation["source"], relation["relation"], relation["target"])
            for relation in extract_entities_and_relations(example["text"])["relations"]
        }
        true_positive = len(expected & predicted)
        false_positive = len(predicted - expected)
        false_negative = len(expected - predicted)
        totals["true_positives"] += true_positive
        totals["false_positives"] += false_positive
        totals["false_negatives"] += false_negative
        precision = true_positive / len(predicted) if predicted else float(not expected)
        recall = true_positive / len(expected) if expected else float(not predicted)
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        macro["precision"].append(precision)
        macro["recall"].append(recall)
        macro["f1"].append(f1)
        if not expected:
            negative_examples += 1
            false_positive_examples += int(bool(predicted))

    count = len(examples)
    predicted_count = totals["true_positives"] + totals["false_positives"]
    gold_count = totals["true_positives"] + totals["false_negatives"]
    result = {
        "examples": count,
        "gold_relations": gold_count,
        "predicted_relations": predicted_count,
        **totals,
        "precision": totals["true_positives"] / predicted_count if predicted_count else 0.0,
        "recall": totals["true_positives"] / gold_count if gold_count else 0.0,
        "f1": 0.0,
        "macro_precision": sum(macro["precision"]) / count if count else 0.0,
        "macro_recall": sum(macro["recall"]) / count if count else 0.0,
        "macro_f1": sum(macro["f1"]) / count if count else 0.0,
        "false_positive_rate": false_positive_examples / negative_examples if negative_examples else 0.0,
        "negative_examples": negative_examples,
        "false_positive_examples": false_positive_examples,
    }
    result["f1"] = (
        2 * result["precision"] * result["recall"] / (result["precision"] + result["recall"])
        if result["precision"] + result["recall"] else 0.0
    )
    logger.info("Extraction benchmark: %s", json.dumps(result, sort_keys=True))
    return result
