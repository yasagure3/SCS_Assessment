import type { ReportSnapshot, ReportLimitations } from "../../shared/contracts/reports";
import { MAX_REPORT_BYTES } from "../../shared/contracts/assessment";

export const PDF_RENDERER_VERSION = "scs-report-1";
export type ReportSection = { title: string; paragraphs: string[]; criterionId?: string };
const status = {
  yes: "○ 満たしている",
  uncertain: "△ 判断微妙",
  no: "× 不足",
  unanswered: "未回答",
};
const reviews = { confirmed: "確認済み", unreviewed: "未確認", rejected: "差戻し" };
const adviceStates = {
  current: "確定済み",
  none: "助言なし",
  unconfirmed: "未確定のため本文なし",
  stale: "再確認が必要なため本文なし",
};
const limitations: Record<keyof ReportLimitations, string> = {
  unanswered: "未回答",
  notRegistered: "証跡未登録",
  unreviewed: "証跡未確認",
  rejected: "証跡差戻し",
  unconfirmedAdvice: "助言未確定",
  staleAdvice: "再確認が必要な助言",
  draftPendingIds: "新しい下書きあり（確定済み版を出力。新しい下書きは含めない）",
};
const filled = (value: string | null) => value || "記載なし";

export function reportPdfSections(snapshot: ReportSnapshot): ReportSection[] {
  const criteria = snapshot.standard.criteria;
  const ids = new Set(criteria.map((c) => c.id));
  if (
    snapshot.schemaVersion !== 1 ||
    criteria.length !== 81 ||
    ids.size !== 81 ||
    Object.keys(snapshot.responses).length !== 81 ||
    [...ids].some((id) => !snapshot.responses[id]) ||
    new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_REPORT_BYTES
  )
    throw new Error("REPORT_SNAPSHOT_INVALID");
  const scope = snapshot.assessment.scope;
  const sections: ReportSection[] = [
    {
      title: "SCS ★3 診断レポート",
      paragraphs: [
        snapshot.customer.name,
        snapshot.case.name,
        `対象会社：${scope.companies}`,
        `対象拠点：${scope.sites}`,
        `対象部署：${scope.departments}`,
        `対象システム：${scope.systems}`,
        `診断日：${filled(snapshot.assessment.diagnosisDate)}`,
        `制度版：${snapshot.assessment.standardId} / 公表日：${snapshot.standard.publicationDate}`,
        `報告版：${snapshot.reportId} / 診断版：${snapshot.assessment.revision}`,
        `確定日時：${snapshot.createdAt} / 作成者：${snapshot.createdBy}`,
        `保存時の描画版：${snapshot.rendererVersion} / 今回の描画版：${PDF_RENDERER_VERSION}`,
        "対象は全81評価基準です。自己評価は公式の合否や取得可能性を表しません。",
      ],
    },
    {
      title: "経営層向けサマリー",
      paragraphs: [
        ...(["yes", "uncertain", "no", "unanswered"] as const).map(
          (key) => `${status[key]}：${snapshot.counts[key]}件 / 81件`,
        ),
        ...snapshot.categoryCounts.map(
          (c) =>
            `${c.category}：○ ${c.yes} / △ ${c.uncertain} / × ${c.no} / 未回答 ${c.unanswered} / 計 ${c.total}`,
        ),
        "主要課題",
        ...(snapshot.majorIssues.length
          ? snapshot.majorIssues.map(
              (id) => `${id}：${criteria.find((c) => c.id === id)?.officialText ?? ""}`,
            )
          : ["主要課題は選択されていません。"]),
      ],
    },
    {
      title: "留意事項",
      paragraphs: [
        ...Object.entries(limitations).map(([key, label]) => {
          const values = snapshot.limitations[key as keyof ReportLimitations];
          return `${label}：${values.length}件\n${values.join("、") || "該当なし"}`;
        }),
        `制度資料：${snapshot.standard.sourceUrl}`,
        `制度本文 SHA-256：${snapshot.standard.contentSha256}`,
        "留意事項が残った状態の固定レポートです。証跡の登録・確認、作業完了、基準充足はそれぞれ別に確認します。",
      ],
    },
  ];
  for (const criterion of criteria) {
    const response = snapshot.responses[criterion.id];
    const paragraphs = [
      `分類：${criterion.category} / 要求事項 ${criterion.requirementId}`,
      `要求事項：${criterion.requirementText}`,
      `評価基準：${criterion.officialText}`,
      `自己評価：${status[response.status]}`,
      `理由：${filled(response.reason)}`,
      `根拠：${filled(response.basis)}`,
      `今後の作業：${filled(response.plannedWork)}`,
      `補足：${filled(response.supplement)}`,
      `助言：${adviceStates[response.adviceState]}`,
    ];
    // Only the snapshot's selected, current confirmation is publishable. Never enumerate response values.
    const advice = response.adviceState === "current" ? response.confirmedAdvice : null;
    if (advice)
      paragraphs.push(
        `課題・不足：${filled(advice.content.gap)}`,
        ...advice.content.steps.map((s, i) => `実施手順 ${i + 1}：${s}`),
        ...advice.content.evidenceExamples.map((s, i) => `証跡例 ${i + 1}：${s}`),
        `完了確認：${filled(advice.content.completionCheck)}`,
        `助言補足：${filled(advice.content.notes)}`,
        `助言確認者：${advice.reviewer.email} / ${advice.at}`,
      );
    const evidence = snapshot.evidence.filter((e) => e.criterionIds.includes(criterion.id));
    if (!evidence.length) paragraphs.push("証跡：未登録");
    for (const item of evidence) {
      const review = item.reviews[criterion.id];
      paragraphs.push(
        `証跡：${item.name}`,
        `箇所：${filled(item.location)}`,
        `証跡確認：${reviews[review.state]}`,
        `ファイル：${item.file?.originalName ?? "なし"}`,
        `URL：${item.url ?? "なし"}`,
        `確認者：${item.reviewers.find((r) => r.id === review.by)?.email ?? "未確認"} / ${review.at ?? "未確認"}`,
        `確認記録：${filled(review.note)}`,
      );
    }
    const tasks = snapshot.tasks.filter((t) => t.criterionId === criterion.id);
    if (!tasks.length) paragraphs.push("改善課題：登録なし");
    for (const task of tasks)
      paragraphs.push(
        `改善課題：${task.title}`,
        `担当：${filled(task.ownerName)} / 期限：${filled(task.dueDate)}`,
        `進捗：${{ todo: "未着手", doing: "進行中", awaiting_review: "確認待ち", done: "完了" }[task.state]} / 優先度：${{ high: "高", normal: "中", low: "低" }[task.priority]}`,
        `完了条件：${filled(task.completionCondition)}`,
        `結果：${filled(task.result)}`,
        `課題確認：${reviews[task.review.state]} / ${task.reviewer?.email ?? "未確認"} / ${task.review.at ?? "未確認"}`,
        `課題確認記録：${filled(task.review.note)}`,
      );
    sections.push({ title: `項目 ${criterion.id}`, criterionId: criterion.id, paragraphs });
  }
  return sections;
}

export function wrapReportText(
  text: string,
  width: (value: string) => number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  const forbiddenStart = new Set("、。，．）］｝」』】〉》！？：；ー"),
    forbiddenEnd = new Set("（［｛「『【〈《");
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line && width(line + character) > maxWidth) {
        let tail = "";
        if (forbiddenStart.has(character) || forbiddenEnd.has(Array.from(line).at(-1)!)) {
          const previous = Array.from(line);
          tail = previous.pop()!;
          line = previous.join("");
        }
        if (line) lines.push(line);
        line = tail + character;
      } else line += character;
    }
    lines.push(line);
  }
  return lines;
}
