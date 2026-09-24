"""Independent PDF text, embedded-font and pixel QA for anonymous E2E output only."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import tracemalloc

import pdfplumber
from pypdf import PdfReader

started = time.perf_counter()
tracemalloc.start()
out = Path(sys.argv[1])
pdf_path = out / (sys.argv[2] if len(sys.argv) > 2 else "report.pdf")
snapshot = json.loads((out / "snapshot.json").read_text(encoding="utf-8"))
normal = lambda text: re.sub(r"\s+", "", text)
with pdfplumber.open(pdf_path) as pdf:
    pages = [page.extract_text(x_tolerance=1, y_tolerance=3) or "" for page in pdf.pages]
    assert len(pages) >= 84, len(pages)
    # Strip only renderer-owned running text so continued paragraphs join exactly.
    body = "\n".join("\n".join(line for line in text.splitlines()
        if not line.startswith("SCS DIAGNOSIS /")
        and not re.fullmatch(r"項目 [\d-]+（続き）", line)
        and not line.startswith(snapshot["reportId"] + " /")) for text in pages)
    normalized = normal(body)
    expected = [snapshot["customer"]["name"], snapshot["case"]["name"], snapshot["reportId"],
                snapshot["assessment"]["diagnosisDate"], *snapshot["assessment"]["scope"].values()]
    for criterion in snapshot["standard"]["criteria"]:
        assert f"項目 {criterion['id']}" in body
        expected += [criterion["requirementText"], criterion["officialText"]]
        response = snapshot["responses"][criterion["id"]]
        expected += [response[field] for field in ("reason", "basis", "plannedWork", "supplement") if response[field]]
        if response["adviceState"] == "current" and response["confirmedAdvice"]:
            advice = response["confirmedAdvice"]["content"]
            expected += [advice["gap"], *advice["steps"], *advice["evidenceExamples"], advice["completionCheck"], advice["notes"]]
    for text in expected:
        assert normal(text) in normalized, f"Missing complete field: {text[:80]}"
    for key, label in {"yes": "○ 満たしている", "uncertain": "△ 判断微妙", "no": "× 不足", "unanswered": "未回答"}.items():
        assert normal(f"{label}：{snapshot['counts'][key]}件 / 81件") in normalized
    assert "UNCONFIRMED_DRAFT" not in body
    assert "変更後の会社名" not in body and "変更後の回答" not in body
    long_text = snapshot["responses"]["1-2-1-1"]["confirmedAdvice"]["content"]["gap"]
    assert len(long_text) >= 6443
    assert normal(long_text) in normalized
    bounds = 0
    for page_number, page in enumerate(pdf.pages, 1):
        for char in page.chars:
            assert char["x0"] >= 0 and char["x1"] <= page.width + 0.1, (page_number, char)
            assert char["top"] >= 0 and char["bottom"] <= page.height + 0.1, (page_number, char)
            bounds += 1
    long_pages = [i + 1 for i, text in enumerate(pages) if "長文検証" in text]
    assert len(long_pages) > 1
    for number in long_pages[1:]:
        assert "項目 1-2-1-1（続き）" in pages[number - 1]

reader = PdfReader(pdf_path)
embedded = {}
visited = set()
for page in reader.pages:
    for reference in page["/Resources"]["/Font"].values():
        identity = (reference.idnum, reference.generation)
        if identity in visited:
            continue
        visited.add(identity)
        font = reference.get_object()
        descendant = font["/DescendantFonts"][0].get_object()
        descriptor = descendant["/FontDescriptor"].get_object()
        # pdf-lib 1.17.1 emits this full OTF program under FontFile2. The
        # descriptor slot does not replace verification of the actual bytes.
        keys = [key for key in ("/FontFile2", "/FontFile3") if key in descriptor]
        assert len(keys) == 1, list(descriptor.keys())
        stream = descriptor[keys[0]].get_object().get_data()
        embedded[f"{reference.idnum}:{font['/BaseFont']}"] = {"fontFileKey": keys[0], "bytes": len(stream), "sha256": hashlib.sha256(stream).hexdigest()}
assert len(embedded) == 1
font = next(iter(embedded.values()))
assert font["bytes"] == 16_467_736, embedded
assert font["sha256"] == "68a3fc98800b2a27b371f2fb79991daf3633bd89309d4ffaa6946fd587f375b5", embedded
renders = sorted({1, long_pages[0], long_pages[1], (len(pages) + 1) // 2, len(pages)})
if "--no-render" not in sys.argv:
    tool = os.environ.get("PDF_QA_POPPLER", "pdftoppm")
    for number in renders:
        subprocess.run([tool, "-f", str(number), "-l", str(number), "-singlefile", "-r", "100", "-png", str(pdf_path), str(out / f"page-{number:03d}")], check=True, capture_output=True)
_, peak = tracemalloc.get_traced_memory()
result = {"all81Ids": True, "all81OfficialTexts": True, "completeFields": len(expected),
          "longAdviceCharacters": len(long_text), "longAdvicePages": long_pages,
          "unconfirmedDraftExcluded": True, "boundsChecks": bounds, "pages": len(pages),
          "renderedPages": renders if "--no-render" not in sys.argv else [], "embeddedFont": embedded,
          "bytes": pdf_path.stat().st_size, "elapsedSeconds": round(time.perf_counter() - started, 2),
          "pythonTracemallocPeakBytes": peak,
          "memoryScope": "Python QA allocations only; excludes browser/worker and Poppler memory"}
(out / (pdf_path.stem + "-qa.json")).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
