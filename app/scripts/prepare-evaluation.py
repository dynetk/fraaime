"""Prepare private evidence using the exact production PDF worker, without a server."""
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
from main import page_file

manifest_path = Path(sys.argv[1]).resolve()
manifest = json.loads(manifest_path.read_text())
destination = manifest_path.parent / "evidence"
destination.mkdir(parents=True, exist_ok=True)
for case in manifest["cases"]:
    output = destination / (case["id"] + ".json")
    source = Path(case["pdf"])
    if not source.is_absolute():
        source = manifest_path.parent / source
    # Worker scratch images must never be written next to original customer files.
    with tempfile.TemporaryDirectory(prefix="fraaime-eval-") as scratch:
        pdf = Path(scratch) / "source.pdf"
        shutil.copyfile(source, pdf)
        evidence = page_file(pdf, case["page"], 300)
        output.write_text(json.dumps(evidence))
        case["evidence"] = str(output.relative_to(manifest_path.parent))
        print(json.dumps({"id": case["id"], "page": case["page"], "images": len(evidence["images"])}), flush=True)
(manifest_path.parent / "prepared.json").write_text(json.dumps(manifest, indent=2))
