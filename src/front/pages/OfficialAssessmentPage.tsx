import { useCallback, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
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
import { getOfficialProgress, supportsOfficialAnswers } from "../lib/officialProgress";
import { createOfficialDraft, type OfficialDraftChange } from "../lib/officialDraft";

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
  const { hash } = useLocation();
  const answerTarget = useCallback(
    (node: HTMLElement | null) => {
      if (node && hash === `#${node.id}`) {
        node.focus();
        node.scrollIntoView({ block: "start" });
      }
    },
    [hash],
  );
  const [answers, setAnswers] = useState(() =>
    structuredClone(record.document.officialAnswers ?? emptyOfficialAnswers()),
  );
  const [revision, setRevision] = useState(record.revision);
  const [selection, setSelection] = useState(search.get("criterion") ?? "organization");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [draftChanges, setDraftChanges] = useState<OfficialDraftChange[]>([]);
  const [draftReviewed, setDraftReviewed] = useState(false);
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
  const progress = getOfficialProgress(answers);
  const draft = createOfficialDraft(
    record.document.responses,
    answers,
    record.document.officialAnswers ?? emptyOfficialAnswers(),
  );
  const draftIds = [...new Set(draftChanges.map((change) => change.criterionId))];
  const needsDraftReview = draftChanges.length > 0 && !draftReviewed;
  const stale = record.revision !== revision;
  const canDraft = draft.changes.length > 0 && !disabled && !conflict && !stale;
  function update(next: OfficialAnswers) {
    setAnswers(next);
    if (draftChanges.length > 0) setDraftReviewed(false);
    setNotice("");
    setError("");
  }
  function generateDraft() {
    if (!canDraft) return;
    update(draft.answers);
    setDraftReviewed(false);
    setDraftChanges((previous) => {
      const merged = new Map(previous.map((change) => [change.key, change]));
      for (const change of draft.changes) {
        const old = merged.get(change.key);
        merged.set(change.key, {
          ...change,
          result: change.result || Boolean(old?.result),
          answer: change.answer || Boolean(old?.answer),
        });
      }
      return [...merged.values()];
    });
    if (selection === "organization") setSelection(draft.changes[0].criterionId);
    setNotice(
      `下書きを作成しました。判定 ${draft.resultCount}欄・質問への回答 ${draft.answerCount}欄。内容を確認・修正して保存してください。`,
    );
  }
  async function save() {
    if (disabled || conflict || stale || needsDraftReview) return;
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
      setDraftChanges([]);
      setDraftReviewed(false);
      void onSaved(result);
      setNotice("公式シートの回答を保存しました。");
    }
  }
  async function reload() {
    try {
      const latest = await write.read<AssessmentDto>(`/api/v1/assessments/${record.id}`);
      setAnswers(structuredClone(latest.data.document.officialAnswers ?? emptyOfficialAnswers()));
      setRevision(latest.data.revision);
      setDraftChanges([]);
      setDraftReviewed(false);
      void onSaved(latest);
      write.clearError();
      setError("");
      setNotice("");
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
      {record.standardId === "scs-20260327-star3" && (
        <p className="notice">
          この診断の従来の回答は2026年3月27日版です。ここではVer.1.1の公式回答を別に保存します。下書きを利用する場合も、変更された4-4-4-1、4-4-4-2を含めて内容を確認してください。
        </p>
      )}
      {record.standardId !== OFFICIAL_STANDARD_ID && record.standardId !== "scs-20260327-star3" && (
        <p className="notice">
          取込マスタの自己評価・理由・根拠・補足を参照し、Ver.1.1の公式質問に回答してください。公式回答は別に保存します。
        </p>
      )}
      <p>
        この画面の入力状況：判定 {progress.results.filled} / {progress.results.total}
        件、質問への回答 {progress.questions.filled} / {progress.questions.total}
        件（対象外を除く）。
      </p>
      <p>
        <Link to={`/assessments/${record.id}/official-status`}>
          保存済みの公式回答状況・記載漏れを確認
        </Link>
        {dirty && "（未保存の入力は状況画面に反映されません。移動前に保存してください。）"}
      </p>
      <section className="official-draft-panel" aria-labelledby="official-draft-heading">
        <h3 id="official-draft-heading">取込内容から下書きを作成</h3>
        <p>
          評価基準一覧の現在の自己評価・理由・根拠・補足を使い、公式回答の空欄を埋めます。保存済み・編集中の入力と対象外の項目は保持します。
        </p>
        <p className="subtle">
          ○→適合候補、✖→不適合候補。△・未回答は判定を空欄にします。複数の質問には同じ元資料を使うため、質問ごとに必要な文書名・実施内容へ修正してください。
        </p>
        <p>
          {draftIds.length > 0 ? "追加で作成できる下書き" : "作成できる下書き"}：判定{" "}
          {draft.resultCount}欄 ／ 質問への回答 {draft.answerCount}欄
        </p>
        <p className="subtle">
          入力済み {draft.protectedFields}欄を保持 ／ 対象外 {draft.excludedCriteria}基準を除外
        </p>
        <button
          className="button secondary"
          type="button"
          disabled={!canDraft}
          onClick={generateDraft}
        >
          空欄に下書きを作成
        </button>
        {draft.changes.length === 0 && draftIds.length === 0 && (
          <p className="subtle">
            作成できる空欄がありません。取込データの有無と、現在の公式回答を確認してください。
          </p>
        )}
        {draft.tooLongCriteria.length > 0 && (
          <p className="notice">
            {draft.tooLongCriteria.join("、")}
            ：元の文章をまとめると8000文字を超えるため、質問への回答は転記しません。元の内容を参照し、回答欄に要約してください。
          </p>
        )}
        {stale && (
          <p className="notice">
            保存内容が更新されています。最新の保存値を読み直してから下書きを作成してください。
          </p>
        )}
        {draftIds.length > 0 && (
          <p className="notice">
            {draftIds.length}
            評価基準に下書きを反映しました（未保存）。下の回答欄で確認・修正し、画面下部の確認欄にチェックを入れて保存してください。
          </p>
        )}
        {draftIds.length > 0 && (
          <label className="official-draft-navigation">
            確認する下書き（{draftIds.length}評価基準）
            <select
              aria-label="確認する下書き"
              value={draftIds.includes(selection) ? selection : ""}
              onChange={(e) => setSelection(e.target.value)}
            >
              <option value="" disabled>
                評価基準を選択
              </option>
              {catalog.standard.criteria
                .filter((c) => draftIds.includes(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} {c.category}
                  </option>
                ))}
            </select>
          </label>
        )}
      </section>
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
              <label key={key} id={`official-organization-${key}`} tabIndex={-1} ref={answerTarget}>
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
              <div key={q.id} id={`official-scope-${q.id}`} tabIndex={-1} ref={answerTarget}>
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
            {record.document.responses[criterion.id] && (
              <details open>
                <summary>清書用の自己評価・理由・根拠・補足</summary>
                <p>評価基準一覧で整えた内容です。質問ごとに確認して回答欄へ記入してください。</p>
                <dl>
                  {[
                    [
                      "自己評価",
                      { yes: "○", uncertain: "△", no: "✖", unanswered: "未回答" }[
                        record.document.responses[criterion.id].status
                      ],
                    ],
                    ["理由（P列）", record.document.responses[criterion.id].reason],
                    ["根拠（Q列）", record.document.responses[criterion.id].basis],
                    ["補足（R列）", record.document.responses[criterion.id].supplement],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd className="preline">{value || "（空欄）"}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            <Link to={`/assessments/${record.id}/criteria/${criterion.id}`}>
              評価基準一覧の回答・証跡を確認
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
              <fieldset
                key={row.key}
                id={`official-row-${row.key}`}
                tabIndex={-1}
                ref={answerTarget}
                disabled={disabled}
              >
                <legend>適合基準 {index + 1}</legend>
                {draftChanges
                  .filter((change) => change.key === row.key)
                  .map((change) => (
                    <p key={change.key} className="official-draft-badge">
                      取込内容からの下書き・{draftReviewed ? "確認済み" : "要確認"}（
                      {[change.result && "判定", change.answer && "質問への回答"]
                        .filter(Boolean)
                        .join("・")}
                      ）
                    </p>
                  ))}
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
        {draftChanges.length > 0 && (
          <label className="check-field official-draft-review">
            <input
              type="checkbox"
              disabled={disabled}
              checked={draftReviewed}
              onChange={(e) => setDraftReviewed(e.target.checked)}
            />
            作成した下書きを各質問・適合基準に照らして確認・修正しました
          </label>
        )}
        <div className="task-actions">
          <button
            className="button primary"
            disabled={disabled || conflict || stale || needsDraftReview}
          >
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
          公式回答状況で記載漏れを確認できます。固定報告版は診断メモを集計します。
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
      {({ record, readOnly, assessment }) =>
        !supportsOfficialAnswers(record.document.responses) ? (
          <section className="panel">
            <p>
              取込マスタの評価項目IDが公式テンプレートと一致しません。公式シートへの対応関係を確認してください。
            </p>
          </section>
        ) : (
          <OfficialAssessmentForm
            key={record.id}
            record={record}
            readOnly={readOnly}
            onSaved={assessment.replace}
          />
        )
      }
    </AssessmentLayout>
  );
}
