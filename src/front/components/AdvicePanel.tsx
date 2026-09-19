import type { AssessmentDto } from "../../shared/contracts/assessments";
import type { AdviceTemplatesDto } from "../../shared/contracts/advice";
import type { ApiSuccess } from "../../shared/contracts/api";
import { useApi, useWrite, isAccessError } from "../lib/api";
import { AdviceEditor } from "./AdviceEditor";

export function AdvicePanel({
  record,
  criterionId,
  readOnly,
  onSaved,
  onRefresh,
}: {
  record: AssessmentDto;
  criterionId: string;
  readOnly: boolean;
  onSaved: (result: ApiSuccess<AssessmentDto>) => unknown;
  onRefresh: () => unknown;
}) {
  const templates = useApi<AdviceTemplatesDto>(
      `/api/v1/standards/${record.standardId}/advice-templates`,
    ),
    write = useWrite();
  const template = templates.data?.items?.find((item) => item.criterionId === criterionId);
  if (isAccessError(templates.error))
    return <p role="alert">助言の閲覧権限を確認できません。ページを再読み込みしてください。</p>;
  return (
    <>
      {templates.isLoading && <p role="status">定型助言を読み込んでいます…</p>}
      {templates.error && (
        <div className="notice">
          <p role="alert">定型助言を取得できませんでした。手入力は続けられます。</p>
          <button type="button" className="text-button" onClick={() => void templates.mutate()}>
            定型助言を再取得
          </button>
        </div>
      )}
      {!templates.isLoading && !templates.error && !template && (
        <p className="notice">この基準の定型助言はありません。手入力で助言を作成できます。</p>
      )}
      <AdviceEditor
        key={`${record.id}/${criterionId}`}
        record={record}
        criterionId={criterionId}
        template={template}
        readOnly={readOnly}
        write={write}
        onSaved={onSaved}
        onRefresh={onRefresh}
      />
    </>
  );
}
