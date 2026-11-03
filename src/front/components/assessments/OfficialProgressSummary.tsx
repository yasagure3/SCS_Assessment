import { Link } from "react-router";
import type { AssessmentDto } from "../../../shared/contracts/assessments";
import { getOfficialProgress } from "../../lib/officialProgress";

export function OfficialProgressSummary({ record }: { record: AssessmentDto }) {
  const progress = getOfficialProgress(record.document.officialAnswers);
  return (
    <section className="panel">
      <h2>公式回答の状況（★3・Ver.1.1）</h2>
      <p>
        判定 {progress.results.filled} / {progress.results.total}件 ／ 質問への回答{" "}
        {progress.questions.filled} / {progress.questions.total}件
      </p>
      <p>
        未記入がある評価基準 {progress.incompleteCriteria}件 ／ 不適合あり{" "}
        {progress.nonconformingCriteria}件 ／ 対象外 {progress.excludedCriteria}件
      </p>
      <div className="task-actions">
        <Link className="button primary" to={`/assessments/${record.id}/official-status`}>
          公式回答の状況を確認
        </Link>
        <Link className="button secondary" to={`/assessments/${record.id}/official`}>
          公式シートに回答してExcelを出力
        </Link>
      </div>
      <p className="subtle">
        保存済みの公式回答を集計しています。対象外は判定・質問の分母から除きます。以下は診断メモの集計です。
      </p>
    </section>
  );
}
