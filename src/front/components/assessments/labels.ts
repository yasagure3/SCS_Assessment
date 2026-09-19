import type { EvidenceState, Status } from "../../../shared/contracts/assessments";
export const statusLabels: Record<Status, string> = {
  yes: "○ 満たしている",
  uncertain: "△ 判断微妙",
  no: "✖ 不足",
  unanswered: "— 未回答",
};
export const evidenceLabels: Record<EvidenceState | "unconfirmedYes", string> = {
  notRegistered: "証跡未登録",
  unreviewed: "未確認の証跡あり",
  rejected: "差戻しの証跡あり",
  allConfirmed: "全証跡を確認済み",
  unconfirmedYes: "未確認の○",
};
export const responseLabels = {
  status: "現在の自己評価",
  reason: "判定理由・確認メモ",
  basis: "確認した既存の根拠",
  plannedWork: "今後の作業",
  supplement: "補足情報",
};
