import { useState } from "react";
import { useNavigate } from "react-router";
import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import { ComparisonView } from "../components/ComparisonView";
import { ReassessmentForm } from "../components/ReassessmentForm";
import { LoadState } from "../components/WorkspaceShell";
import { useApi, useWrite, isAccessError } from "../lib/api";
import type { ComparisonDto } from "../../shared/contracts/improvement";
import type { AssessmentDto } from "../../shared/contracts/assessments";
import type { AssessmentListItem } from "../../shared/contracts/cases";
import type { ApiPage } from "../../shared/contracts/api";

function ComparisonResult({
  id,
  previous,
  revision,
}: {
  id: string;
  previous: string;
  revision: string;
}) {
  const [snapshot, setSnapshot] = useState<ComparisonDto | null>(null);
  const result = useApi<ComparisonDto>(
    `/api/v1/assessments/${id}/comparison?previous=${encodeURIComponent(previous)}${revision ? `&previousRevision=${encodeURIComponent(revision)}` : ""}`,
    {
      dedupingInterval: 0,
      revalidateOnMount: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // A cached isValidating:false can be returned before mount revalidation starts.
      // Only a successful request in this view may establish its fixed pair.
      onSuccess: (response) => setSnapshot((current) => current ?? response.data),
    },
  );
  return (
    <>
      <LoadState error={result.error} loading={!snapshot && !result.error} retry={result.mutate} />
      {snapshot && !result.error && <ComparisonView data={snapshot} />}
    </>
  );
}
function ComparisonWorkspace({
  record,
  readOnly,
  refresh,
}: {
  record: AssessmentDto;
  readOnly: boolean;
  refresh: () => Promise<void>;
}) {
  const navigate = useNavigate(),
    write = useWrite();
  const [cursor, setCursor] = useState<string | null>(null);
  const list = useApi<ApiPage<AssessmentListItem>>(
    `/api/v1/cases/${record.caseId}/assessments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  const [previous, setPrevious] = useState(record.document.copiedFrom?.assessmentId ?? "");
  const [revision, setRevision] = useState("");
  const [selection, setSelection] = useState({ previous, revision: "", attempt: 0 });
  const candidates = list.data?.items.filter((item) => item.id !== record.id) ?? [];
  const blocked = isAccessError(list.error);
  return (
    <>
      <section className="panel">
        <h2>比較する診断を選択</h2>
        <LoadState error={list.error} loading={list.isLoading} retry={list.mutate} />
        {!blocked && (
          <form
            className="data-form comparison-picker"
            onSubmit={(e) => {
              e.preventDefault();
              setSelection({ previous, revision, attempt: selection.attempt + 1 });
            }}
          >
            <label>
              前回の診断
              <select
                value={previous}
                onChange={(e) => {
                  setPrevious(e.target.value);
                  setRevision("");
                }}
              >
                <option value="">比較する診断を選択</option>
                {previous && !candidates.some((item) => item.id === previous) && (
                  <option value={previous}>保存済みの前回診断</option>
                )}
                {candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.diagnosisDate ?? "診断日未入力"} / 最新 revision {item.revision} /{" "}
                    {item.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              前回revision（空欄はコピー時の版、その他は最新）
              <input
                type="number"
                min={1}
                step={1}
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
              />
            </label>
            <button
              className="button secondary"
              disabled={
                !previous ||
                list.isLoading ||
                !!list.error ||
                (!!revision && (!Number.isInteger(Number(revision)) || Number(revision) < 1))
              }
            >
              この組み合わせで比較
            </button>
            <p className="field-help">
              直接のコピー元は保存済みのrevisionが既定です。現時点と比較する場合は一覧に表示された最新revisionを入力してください。
            </p>
            {!candidates.length && !previous && !list.isLoading && (
              <p>前回の診断がありません。下のフォームから新しい診断時点を作成できます。</p>
            )}
            <div className="pagination">
              {cursor && (
                <button type="button" className="text-button" onClick={() => setCursor(null)}>
                  候補の先頭へ
                </button>
              )}
              {list.data?.nextCursor && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setCursor(list.data!.nextCursor)}
                >
                  次の候補
                </button>
              )}
            </div>
          </form>
        )}
      </section>
      {!blocked && selection.previous && (
        <ComparisonResult
          key={`${selection.previous}/${selection.revision}/${selection.attempt}`}
          id={record.id}
          previous={selection.previous}
          revision={selection.revision}
        />
      )}
      {!blocked && (
        <ReassessmentForm
          record={record}
          readOnly={readOnly}
          write={write}
          onRefresh={refresh}
          onCreated={(created) => navigate(`/assessments/${created.id}/comparison`)}
        />
      )}
    </>
  );
}
export function ComparisonPage() {
  return (
    <AssessmentLayout title="再診断比較">
      {({ record, readOnly, refresh }) => (
        <ComparisonWorkspace
          key={record.id}
          record={record}
          readOnly={readOnly}
          refresh={refresh}
        />
      )}
    </AssessmentLayout>
  );
}
