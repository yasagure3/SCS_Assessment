import { describe, expect, it } from "vitest";
import { reportSnapshotFixture, longReportAdvice } from "../../tests/fixtures/reportSnapshot";
import { reportPdfSections, wrapReportText } from "../../src/front/workers/reportPdfContent";

describe("PDF fixed snapshot content", () => {
  it("prints frozen evidence, reviewer and task values while excluding stale confirmation bodies", () => {
    const snapshot = reportSnapshotFixture(),
      id = snapshot.majorIssues[0];
    snapshot.responses[id].adviceState = "stale";
    const review = {
      state: "confirmed" as const,
      note: "現物を照合済み",
      by: "reviewer",
      at: "2026-09-24T00:00:00.000Z",
      subjectHash: "b".repeat(64),
    };
    snapshot.evidence = [
      {
        id: "evidence",
        criterionIds: [id],
        name: "運用記録",
        location: "第３章",
        fileId: "file",
        url: "https://example.invalid/evidence",
        reviews: { [id]: review },
        file: {
          id: "file",
          originalName: "確定時の記録.txt",
          mime: "text/plain",
          sizeBytes: 5,
          sha256: "c".repeat(64),
        },
        reviewers: [{ id: "reviewer", email: "fixed@example.invalid" }],
      },
    ];
    snapshot.tasks = [
      {
        id: "task",
        sourceTaskId: null,
        sourceAssessmentId: null,
        criterionId: id,
        title: "月次確認",
        ownerName: "固定担当者",
        dueDate: "2026-09-30",
        priority: "high",
        state: "done",
        completionCondition: "責任者が照合",
        result: "照合完了",
        evidenceIds: ["evidence"],
        review,
        reviewer: { id: "reviewer", email: "fixed@example.invalid" },
      },
    ];
    const paragraphs = reportPdfSections(snapshot).find(
      (section) => section.criterionId === id,
    )!.paragraphs;
    expect(paragraphs.slice(8)).toEqual([
      "助言：再確認が必要なため本文なし",
      "証跡：運用記録",
      "箇所：第３章",
      "証跡確認：確認済み",
      "ファイル：確定時の記録.txt",
      "URL：https://example.invalid/evidence",
      "確認者：fixed@example.invalid / 2026-09-24T00:00:00.000Z",
      "確認記録：現物を照合済み",
      "改善課題：月次確認",
      "担当：固定担当者 / 期限：2026-09-30",
      "進捗：完了 / 優先度：高",
      "完了条件：責任者が照合",
      "結果：照合完了",
      "課題確認：確認済み / fixed@example.invalid / 2026-09-24T00:00:00.000Z",
      "課題確認記録：現物を照合済み",
    ]);
  });
  it("includes all 81 official texts, answers and complete confirmed advice without draft text", () => {
    const snapshot = reportSnapshotFixture();
    // An unexpected draft property must never become a printable field.
    Object.assign(snapshot.responses[snapshot.majorIssues[0]], {
      adviceDraft: { gap: "UNCONFIRMED_DRAFT" },
    });
    const sections = reportPdfSections(snapshot);
    const criteria = sections.filter((section) => section.criterionId);
    expect(criteria.map((section) => section.criterionId)).toEqual(
      snapshot.standard.criteria.map((c) => c.id),
    );
    for (const [index, section] of criteria.entries()) {
      const c = snapshot.standard.criteria[index];
      expect(section.paragraphs.slice(0, 7)).toEqual([
        `分類：${c.category} / 要求事項 ${c.requirementId}`,
        `要求事項：${c.requirementText}`,
        `評価基準：${c.officialText}`,
        `自己評価：${index === 0 ? "○ 満たしている" : "未回答"}`,
        `理由：理由 ${c.id}`,
        `根拠：根拠 ${c.id}`,
        `今後の作業：今後の作業 ${c.id}`,
      ]);
    }
    expect(Array.from(longReportAdvice).length).toBeGreaterThanOrEqual(6443);
    expect(criteria[0].paragraphs.slice(8)).toEqual([
      "助言：確定済み",
      `課題・不足：${longReportAdvice}`,
      "実施手順 1：責任者を設定する",
      "実施手順 2：月次点検を記録する",
      "証跡例 1：点検記録",
      "証跡例 2：運用規程",
      "完了確認：直近３か月分を照合する",
      "助言補足：匿名確認済み助言",
      "助言確認者：reviewer@example.invalid / 2026-09-24T00:00:00.000Z",
      "証跡：未登録",
      "改善課題：登録なし",
    ]);
    expect(JSON.stringify(sections).includes("UNCONFIRMED_DRAFT")).toBe(false);
  });
  it("rejects incomplete, duplicate, unknown-schema and oversized snapshots", () => {
    for (const change of [
      (s: ReturnType<typeof reportSnapshotFixture>) => s.standard.criteria.pop(),
      (s: ReturnType<typeof reportSnapshotFixture>) => {
        s.standard.criteria[1] = s.standard.criteria[0];
      },
      (s: ReturnType<typeof reportSnapshotFixture>) => {
        Object.assign(s, { schemaVersion: 2 });
      },
      (s: ReturnType<typeof reportSnapshotFixture>) => {
        s.customer.name = "a".repeat(1_572_865);
      },
    ]) {
      const snapshot = structuredClone(reportSnapshotFixture());
      change(snapshot);
      expect(() => reportPdfSections(snapshot)).toThrow("REPORT_SNAPSHOT_INVALID");
    }
  });
  it("preserves every codepoint through wrapping, including long paragraphs and supplementary characters", () => {
    const value = "確認（手順）、結果。𠮷田\n" + longReportAdvice;
    const lines = wrapReportText(value, (s) => Array.from(s).length, 24);
    expect(lines.join("")).toBe(value.replaceAll("\n", ""));
    expect(lines.every((line) => Array.from(line).length <= 24)).toBe(true);
  });
});
