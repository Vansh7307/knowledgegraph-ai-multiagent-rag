import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.extraction_metrics import extraction_metrics


if __name__ == "__main__":
    fixture = Path(__file__).parent / "fixtures" / "extraction_gold_large.json"
    print(json.dumps({
        "dataset": fixture.name,
        **extraction_metrics(fixture),
    }, indent=2, sort_keys=True))
