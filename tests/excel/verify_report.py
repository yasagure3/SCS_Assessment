"""Independent OOXML reader: compare anonymous browser downloads with their fixed snapshot."""
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit, parse_qsl
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import pdfplumber

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
STATES = {"yes": "○ 満たしている", "uncertain": "△ 判断微妙", "no": "× 不足", "unanswered": "未回答"}
REVIEWS = {"confirmed": "確認済み", "unreviewed": "未確認", "rejected": "差戻し"}
LIMITS = {"unanswered": "未回答", "notRegistered": "証跡未登録", "unreviewed": "証跡未確認", "rejected": "証跡差戻し", "unconfirmedAdvice": "助言未確定", "staleAdvice": "再確認が必要な助言", "draftPendingIds": "新しい下書きあり（確定済み版を出力。新しい下書きは含めない）"}


def document_url(value):
    if not value:
        return ""
    url = urlsplit(value)
    keys = [k for k, _ in parse_qsl(url.query, keep_blank_values=True) + parse_qsl(url.fragment, keep_blank_values=True)]
    def credential_name(key):
        words = re.sub(r"([A-Z])([A-Z][a-z])", r"\1_\2", key)
        words = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", words)
        words = re.sub(r"[^a-zA-Z0-9]+", "_", words)
        return re.search(r"token|signature|credential|password|secret|authorization|(?:^|_)(auth|sig|key|code)(?:$|_)", words, re.I) or re.fullmatch(r"(api|access|auth|session|private|signing)(key|code)", words.replace("_", "").lower())
    if url.username or url.password or any(credential_name(key) for key in keys):
        return "アクセス情報を含むURLのため省略"
    return value


def decode_xstring(value):
    # One pass only: an escaped lead underscore protects the literal _xHHHH_.
    return re.sub(r"_x([0-9A-Fa-f]{4})_", lambda match: chr(int(match[1], 16)), value)


def read_workbook(path):
    sheets = {}
    with ZipFile(path) as archive:
        for name in archive.namelist():
            assert "externalLink" not in name
            if name.endswith(".rels"):
                assert all(r.get("TargetMode") != "External" for r in ET.fromstring(archive.read(name)))
        shared = [decode_xstring("".join(node.itertext())) for node in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        for sheet in workbook.findall("s:sheets/s:sheet", NS):
            target = rels[sheet.get(f"{{{REL}}}id")]
            xml = ET.fromstring(archive.read(target.lstrip("/") if target.startswith("/") else "xl/" + target))
            assert xml.findall(".//s:f", NS) == [], "Formula cell"
            assert xml.findall(".//s:hyperlink", NS) == [], "Active hyperlink"
            rows = []
            for row in xml.findall("s:sheetData/s:row", NS):
                values = []
                for cell in row.findall("s:c", NS):
                    letters = re.match(r"[A-Z]+", cell.get("r")).group()
                    column = 0
                    for char in letters:
                        column = column * 26 + ord(char) - ord("A") + 1
                    # No implicit missing cells: explicit empty strings are part of the contract.
                    assert column == len(values) + 1, cell.attrib
                    value = cell.find("s:v", NS)
                    if cell.get("t") == "s":
                        values.append(shared[int(value.text)])
                    else:
                        assert sheet.get("name") == "サマリー" and column >= 3, cell.attrib
                        assert cell.get("t") in (None, "n") and value is not None
                        values.append(int(value.text))
                rows.append(values)
            sheets[sheet.get("name")] = rows
    return sheets


def advice_text(response):
    advice = response["confirmedAdvice"] if response["adviceState"] == "current" else None
    if not advice:
        return ""
    content = advice["content"]
    return "\n".join([
        "課題・不足：" + content["gap"],
        *[f"実施手順 {i + 1}：{text}" for i, text in enumerate(content["steps"])],
        *[f"証跡例 {i + 1}：{text}" for i, text in enumerate(content["evidenceExamples"])],
        "完了確認：" + content["completionCheck"], "補足：" + content["notes"],
        "確認者：" + advice["reviewer"]["email"], "確認日：" + advice["at"], f"確認版：{advice['version']}",
    ])


def verify(out, filename):
    snapshot = json.loads((out / "snapshot.json").read_text(encoding="utf-8"))
    sheets = read_workbook(out / filename)
    assert list(sheets) == ["サマリー", "評価基準", "証跡", "改善課題", "未回答・未確認"]
    criteria = snapshot["standard"]["criteria"]
    expected = [["ID", "要求事項", "分類", "公式文", "自己評価", "理由", "根拠", "今後作業", "補足", "原O", "原P", "原Q", "原R", "確定助言", "助言状態"]]
    advice_states = {"current": "確定済み", "none": "助言なし", "unconfirmed": "未確定", "stale": "再確認が必要"}
    for c in criteria:
        response = snapshot["responses"][c["id"]]
        original = response["original"] or {}
        expected.append([c["id"], c["requirementId"], c["category"], c["officialText"], STATES[response["status"]], *[response[k] for k in ("reason", "basis", "plannedWork", "supplement")], *[original.get(k, "") for k in "OPQR"], advice_text(response), advice_states[response["adviceState"]]])
    assert len(expected) == 82 and sheets["評価基準"] == expected, "81 criterion rows differ"
    expected = [["ID", "基準ID", "文書名", "URL", "箇所", "ファイル名", "確認状態", "確認者", "確認日"]]
    for item in snapshot["evidence"]:
        for cid in item["criterionIds"]:
            review = item["reviews"][cid]
            reviewer = next((r["email"] for r in item["reviewers"] if r["id"] == review["by"]), "")
            expected.append([item["id"], cid, item["name"], document_url(item["url"]), item["location"], (item["file"] or {}).get("originalName", ""), REVIEWS[review["state"]], reviewer, review["at"] or ""])
    assert sheets["証跡"] == expected, "Frozen evidence rows differ"
    expected = [["基準ID", "課題", "担当", "期限", "進捗", "完了条件", "結果", "確認"]]
    for task in snapshot["tasks"]:
        review = task["review"]
        reviewer = (task["reviewer"] or {}).get("email", "")
        review_text = f"{REVIEWS[review['state']]}\n確認者：{reviewer}\n確認日：{review['at'] or ''}\n確認記録：{review['note']}"
        expected.append([task["criterionId"], task["title"], task["ownerName"], task["dueDate"], {"todo": "未着手", "doing": "進行中", "awaiting_review": "確認待ち", "done": "完了"}[task["state"]], task["completionCondition"], task["result"], review_text])
    assert sheets["改善課題"] == expected, "Frozen tasks differ"
    official = {c["id"]: c["officialText"] for c in criteria}
    expected = [["種別", "基準ID", "内容"]] + [[label, cid, official[cid]] for key, label in LIMITS.items() for cid in snapshot["limitations"][key]]
    assert sheets["未回答・未確認"] == expected, "Limitations differ"
    summary = sheets["サマリー"]
    assert summary[0] == ["項目", "内容", "○", "△", "×", "未回答", "合計"]
    counts = snapshot["counts"]
    assert [row for row in summary if row[0] == "集計"] == [["集計", "全評価基準", *[counts[k] for k in ("yes", "uncertain", "no", "unanswered", "total")]]]
    assert [row for row in summary if row[0] == "分類集計"] == [["分類集計", c["category"], *[c[k] for k in ("yes", "uncertain", "no", "unanswered", "total")]] for c in snapshot["categoryCounts"]]
    meta = {row[0]: row[1] for row in summary if row[0] not in ("集計", "分類集計", "留意事項", "主要課題")}
    for key, value in {"報告版ID": snapshot["reportId"], "顧客": snapshot["customer"]["name"], "案件": snapshot["case"]["name"], "対象会社": snapshot["assessment"]["scope"]["companies"], "対象拠点": snapshot["assessment"]["scope"]["sites"], "対象部署": snapshot["assessment"]["scope"]["departments"], "対象システム": snapshot["assessment"]["scope"]["systems"], "診断日": snapshot["assessment"]["diagnosisDate"], "保存時の描画版": snapshot["rendererVersion"], "今回の描画版": "scs-report-1", "利用上の注意": "作業用Excelは再取込対象外です。公式Excelの書式は再現していません。"}.items():
        assert meta[key] == value, key
    expected = [["留意事項", f"{label}：{len(snapshot['limitations'][key])}件\n" + ("、".join(snapshot["limitations"][key]) or "該当なし"), "", "", "", "", ""] for key, label in LIMITS.items()]
    assert [row for row in summary if row[0] == "留意事項"] == expected
    flattened = json.dumps(sheets, ensure_ascii=False)
    for forbidden in ["UNCONFIRMED_DRAFT", "ACCESS_SECRET", "SIGNED_SECRET", "ANONYMOUS_SECRET", "変更後の会社名", "変更後の回答"]:
        assert forbidden not in flattened, forbidden
    # The paired PDF is generated via the same selected report's real worker.
    # Use the same independently verified extractor as PDF QA. pypdf's repeated
    # text extraction from a full CJK font can exceed the browser test's deadline.
    with pdfplumber.open(out / "report.pdf") as pdf:
        pdf_text = "".join(page.extract_text(x_tolerance=1, y_tolerance=3) or "" for page in pdf.pages)
    normalized = re.sub(r"\s+", "", pdf_text)
    assert snapshot["reportId"] in pdf_text
    for key, label in STATES.items():
        assert re.sub(r"\s+", "", f"{label}：{counts[key]}件 / 81件") in normalized
    result = {"reportId": snapshot["reportId"], "sheets": list(sheets), "criteria": 81, "counts": counts, "allRowsMatch": True, "pdfMatches": True}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    verify(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else "report.xlsx")
