import logging

from src.extraction_metrics import extraction_metrics


def test_labeled_extraction_precision_recall_are_logged(caplog):
    with caplog.at_level(logging.INFO):
        metrics = extraction_metrics()
        logging.info("Rule-extraction validation: %s", metrics)

    assert metrics["examples"] == 7
    assert metrics["gold_relations"] == 5
    assert metrics["precision"] >= 0.8
    assert metrics["recall"] >= 0.8
    assert "Rule-extraction validation" in caplog.text
