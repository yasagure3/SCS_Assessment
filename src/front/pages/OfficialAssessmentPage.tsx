import { useCallback, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import { useWrite } from "../lib/api";
import { ApiError } from "../lib/fetcher";
import { getSessionGeneration } from "../lib/cognitoClient";
import type { AssessmentDto } from "../../shared/contracts/assessments";
import type { ApiSuccess } from "../../shared/contracts/api";
import {
  emptyOfficialAnswers,
  officialAnswersSchema,
  officialCatalog as catalog,
  OFFICIAL_STANDARD_ID,
  type OfficialAnswers,
} from "../../shared/contracts/officialAssessment";

export function OfficialAssessmentForm({
  record,
  readOnly,
  onSaved,
}: {
  record: AssessmentDto;
  readOnly: boolean;
  onSaved: (result: ApiSuccess<AssessmentDto>) => unknown;
}) {
  const [search] = useSearchParams();
  const [answers, setAnswers] = useState(() =>
    structuredClone(record.document.officialAnswers ?? emptyOfficialAnswers()),
  );
  const [revision, setRevision] = useState(record.revision);
  const [selection, setSelection] = useState(search.get("criterion") ?? "organization");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const write = useWrite();
  const generation = useRef(0);
  const lifecycle = useCallback((node: HTMLElement | null) => {
    if (node)
      return () => {
        generation.current++;
      };
  }, []);
  const dirty =
    JSON.stringify(answers) !==
    JSON.stringify(record.document.officialAnswers ?? emptyOfficialAnswers());
  const conflict = write.error instanceof ApiError && write.error.code === "CONFLICT";
  const disabled = readOnly || write.pending || exporting;
  const criterion = catalog.standard.criteria.find((c) => c.id === selection);
  const rows = catalog.rows.filter((r) => r.criterionId === selection);
  function update(next: OfficialAnswers) {
    setAnswers(next);
    setNotice("");
    setError("");
  }
  async function save() {
    const parsed = officialAnswersSchema.safeParse(answers);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    const result = await write.send<AssessmentDto>(
      `/api/v1/assessments/${record.id}/official-assessment`,
      "PATCH",
      { expectedRevision: revision, answers: parsed.data },
    );
    if (result) {
      setRevision(result.data.revision);
      void onSaved(result);
      setNotice("公式シートの回答を保存しました。");
    }
  }
  async function reload() {
    try {
      const latest = await write.read<AssessmentDto>(`/api/v1/assessments/${record.id}`);
      setAnswers(structuredClone(latest.data.document.officialAnswers ?? emptyOfficialAnswers()));
      setRevision(latest.data.revision);
      void onSaved(latest);
      write.clearError();
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "再読み込みに失敗しました。");
    }
  }
  async function exportExcel() {
    const run = ++generation.current;
    const sessionGeneration = getSessionGeneration();
    setExporting(true);
    setError("");
    try {
      // Export a fresh authorized saved revision, never an unsaved form or stale cache.
      const latest = await write.read<AssessmentDto>(`/api/v1/assessments/${record.id}`);
      if (latest.data.revision !== revision)
        throw new Error("保存内容が更新されています。最新の保存値を読み直してください。");
      if (!latest.data.document.officialAnswers)
        throw new Error("先に公式シートの回答を保存してください。");
      const template = await fetch(`/official/${catalog.template.file}`);
      if (!template.ok) throw new Error("公式テンプレートを取得できません。");
      const { createOfficialExcel } = await import("../workers/officialExcel");
      const bytes = await createOfficialExcel(
        new Uint8Array(await template.arrayBuffer()),
        latest.data.document.officialAnswers,
      );
      // Recheck access/session after generation and suppress downloads after unmount/logout.
      await write.read<AssessmentDto>(`/api/v1/assessments/${record.id}`);
      if (run !== generation.current || sessionGeneration !== getSessionGeneration()) return;
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `SCS-official-${record.id}-r${revision}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`保存済みリビジョン ${revision} の公式Excelを出力しました。`);
    } catch (failure) {
      if (run === generation.current)
        setError(failure instanceof Error ? failure.message : "Excel出力に失敗しました。");
    } finally {
      if (run === generation.current) setExporting(false);
    }
  }
  return (
    <section className="panel official-assessment" ref={lifecycle}>
      <h2>公式アセスメントシートに回答</h2>
      <p>
        要求事項・評価基準 Ver.1.1 ／ アセスメントシート
        Ver.1.0（2026年10月29日更新）。★3の81評価基準・108適合基準に対応します。
      </p>
      <p>
        各自己評価方法で証跡を確認し、「適合」「不適合」を選択してください。未確認は空欄で保存できます。対象外はガイドの条件を確認し、理由を記入してください。
      </p>
      <p>
        <a
          href="https://www.ipa.go.jp/security/scs/rcu1hd0000007a2i-att/SCS-410-self-assess-guide-v1.0.pdf"
          target="_blank"
          rel="noreferrer"
        >
          自己評価等ガイド
        </a>{" "}
        ／{" "}
        <a
          href="https://www.ipa.go.jp/security/scs/rcu1hd0000007a2i-att/SCS-620-handbook-v1.0.pdf"
          target="_blank"
          rel="noreferrer"
        >
          解説書
        </a>
      </p>
      {record.standardId !== OFFICIAL_STANDARD_ID && (
        <p className="notice">
          この診断の従来の回答は2026年3月27日版です。ここではVer.1.1の公式回答を別に保存します。従来の○・△・×、根拠・助言は自動転記しません。変更された4-4-4-1、4-4-4-2も確認してください。
        </p>
      )}
      <p>
        入力状況：
        {
          catalog.rows.filter(
            (r) => answers.criteria[r.criterionId].excluded || answers.rows[r.key].result,
          ).length
        }{" "}
        / 108適合基準、
        {catalog.rows.filter((r) => r.question && answers.rows[r.key].answer.trim()).length} /
        89質問。対象外を含む入力状況であり、取得判定ではありません。
      </p>
      <label>
        入力する項目
        <select value={selection} onChange={(e) => setSelection(e.target.value)}>
          <option value="organization">登録組織・適用範囲</option>
          {catalog.standard.criteria.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} {c.category}
            </option>
          ))}
        </select>
      </label>
      <form
        className="data-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {selection === "organization" && (
          <>
            <h3>登録組織</h3>
            {(
              [
                ["name", "登録組織の名称"],
                ["address", "登録組織の住所"],
                ["unit", "取得単位"],
                ["scope", "適用範囲"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  rows={2}
                  maxLength={8000}
                  disabled={disabled}
                  value={answers.organization[key]}
                  onChange={(e) =>
                    update({
                      ...answers,
                      organization: { ...answers.organization, [key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
            <h3>適用範囲に関する質問事項</h3>
            {catalog.scopeQuestions.map((q) => (
              <div key={q.id}>
                <label>
                  <span className="preline">
                    {q.id} {q.question}
                  </span>
                  {q.options ? (
                    <select
                      disabled={disabled}
                      value={answers.scopeAnswers[q.id]}
                      onChange={(e) =>
                        update({
                          ...answers,
                          scopeAnswers: { ...answers.scopeAnswers, [q.id]: e.target.value },
                        })
                      }
                    >
                      <option value="">未回答</option>
                      {q.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      rows={3}
                      maxLength={8000}
                      disabled={disabled}
                      value={answers.scopeAnswers[q.id]}
                      onChange={(e) =>
                        update({
                          ...answers,
                          scopeAnswers: { ...answers.scopeAnswers, [q.id]: e.target.value },
                        })
                      }
                    />
                  )}
                </label>
                <details>
                  <summary>補足事項</summary>
                  <p className="preline">{q.help}</p>
                </details>
              </div>
            ))}
          </>
        )}
        {criterion && (
          <>
            <h3>評価基準 {criterion.id}</h3>
            <p className="preline">{criterion.officialText}</p>
            <Link to={`/assessments/${record.id}/criteria/${criterion.id}`}>
              従来の診断メモ・証跡を確認
            </Link>
            <label className="check-field">
              <input
                type="checkbox"
                disabled={disabled}
                checked={answers.criteria[criterion.id].excluded}
                onChange={(e) =>
                  update({
                    ...answers,
                    criteria: {
                      ...answers.criteria,
                      [criterion.id]: {
                        ...answers.criteria[criterion.id],
                        excluded: e.target.checked,
                      },
                    },
                  })
                }
              />
              評価基準全体を対象外とする
            </label>
            <label>
              対象外とする理由
              <textarea
                rows={3}
                maxLength={8000}
                disabled={disabled}
                value={answers.criteria[criterion.id].exclusionReason}
                onChange={(e) =>
                  update({
                    ...answers,
                    criteria: {
                      ...answers.criteria,
                      [criterion.id]: {
                        ...answers.criteria[criterion.id],
                        exclusionReason: e.target.value,
                      },
                    },
                  })
                }
              />
            </label>
            {answers.criteria[criterion.id].excluded && (
              <p className="notice">
                対象外の場合、自己評価結果はExcelに出力しません。入力済みの結果は保存して保持します。
              </p>
            )}
            {rows.map((row, index) => (
              <fieldset key={row.key} disabled={disabled}>
                <legend>適合基準 {index + 1}</legend>
                <p className="preline">{row.conformity}</p>
                <details open>
                  <summary>自己評価方法</summary>
                  <p className="preline">{row.method}</p>
                </details>
                <label>
                  自己評価結果 {index + 1}
                  <select
                    disabled={answers.criteria[criterion.id].excluded}
                    value={answers.rows[row.key].result}
                    onChange={(e) =>
                      update({
                        ...answers,
                        rows: {
                          ...answers.rows,
                          [row.key]: {
                            ...answers.rows[row.key],
                            result: e.target.value as "" | "適合" | "不適合",
                          },
                        },
                      })
                    }
                  >
                    <option value="">未回答</option>
                    <option>適合</option>
                    <option>不適合</option>
                  </select>
                </label>
                {row.question && (
                  <label>
                    <span className="preline">{row.question}</span>
                    <textarea
                      aria-label={`質問への回答 ${index + 1}`}
                      rows={4}
                      maxLength={8000}
                      value={answers.rows[row.key].answer}
                      onChange={(e) =>
                        update({
                          ...answers,
                          rows: {
                            ...answers.rows,
                            [row.key]: { ...answers.rows[row.key], answer: e.target.value },
                          },
                        })
                      }
                    />
                  </label>
                )}
              </fieldset>
            ))}
          </>
        )}
        <div className="task-actions">
          <button className="button primary" disabled={disabled || conflict}>
            公式回答を保存
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={disabled || dirty || !record.document.officialAnswers}
            onClick={() => void exportExcel()}
          >
            {exporting ? "出力しています…" : "公式Excelを出力"}
          </button>
        </div>
        <p className="subtle">
          {dirty
            ? "未保存の入力があります。出力前に保存してください。"
            : "保存済みの公式回答を出力します。"}{" "}
          確認責任者の記名・自己適合宣言はExcelで確認後に記入してください。
        </p>
        <p className="subtle">
          公式回答はこの画面と公式Excelで確認します。従来のダッシュボード・固定報告版は診断メモを集計します。
        </p>
        {(error || write.error) && <p role="alert">{error || write.error?.message}</p>}
        {(conflict || record.revision !== revision) && (
          <button type="button" className="button secondary" onClick={() => void reload()}>
            未保存の入力を破棄して最新の保存値を読み直す
          </button>
        )}
        {notice && <p role="status">{notice}</p>}
      </form>
    </section>
  );
}
export function OfficialAssessmentPage() {
  return (
    <AssessmentLayout title="公式シート回答・Excel出力">
      {({ record, readOnly, assessment }) => (
        <OfficialAssessmentForm
          key={record.id}
          record={record}
          readOnly={readOnly}
          onSaved={assessment.replace}
        />
      )}
    </AssessmentLayout>
  );
}
