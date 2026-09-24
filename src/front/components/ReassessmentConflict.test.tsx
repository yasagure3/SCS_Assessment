import { describe, it, expect, vi } from "vite-plus/test";
import { render, screen, within } from "@testing-library/react";
import { ReassessmentForm } from "./ReassessmentForm";
import { assessmentFixture } from "./assessments/assessmentFixtures";
import { ApiError } from "../lib/fetcher";
import { STANDARD_ID, assessmentDocumentSchema } from "../../shared/contracts/assessment";
import type { AssessmentDto } from "../../shared/contracts/assessments";
const uuid = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const review = { state: "unreviewed" as const, note: "", by: null, at: null, subjectHash: null };
function fixture() {
  const { record } = assessmentFixture();
  record.id = uuid(1);
  record.standardId = STANDARD_ID;
  record.document.evidence = [2, 3].map((n) => ({
    id: uuid(n),
    criterionIds: ["C-1"],
    name: "証跡" + n,
    url: null,
    location: "第1章",
    fileId: uuid(n + 10),
    reviews: { "C-1": review },
  }));
  record.document.tasks = [
    {
      id: uuid(4),
      sourceTaskId: null,
      sourceAssessmentId: null,
      criterionId: "C-1",
      title: "課題",
      ownerName: "担当",
      dueDate: "2026-10-01",
      priority: "normal",
      state: "todo",
      completionCondition: "条件",
      result: "",
      evidenceIds: [uuid(2)],
      review,
    },
  ];
  record.document.responses["C-1"].adviceDraft = {
    origin: "manual",
    templateId: null,
    gap: "gap",
    steps: ["one", "two"],
    evidenceExamples: [],
    completionCheck: "check",
    notes: "notes",
  };
  return record;
}
const cases: [string, (record: AssessmentDto) => void][] = [
  ["unchanged negative control", () => {}],
  ...(["companies", "sites", "departments", "systems"] as const).map(
    (field) =>
      [
        "scope." + field,
        (r: AssessmentDto) => {
          r.document.scope[field] = "changed";
        },
      ] as [string, (r: AssessmentDto) => void],
  ),
  [
    "response.status",
    (r) => {
      r.document.responses["C-1"].status = "yes";
    },
  ],
  ...(["reason", "basis", "plannedWork", "supplement"] as const).map(
    (field) =>
      [
        "response." + field,
        (r: AssessmentDto) => {
          r.document.responses["C-1"][field] = "changed";
        },
      ] as [string, (r: AssessmentDto) => void],
  ),
  [
    "advice.origin",
    (r) => {
      r.document.responses["C-1"].adviceDraft!.origin = "ai";
    },
  ],
  [
    "advice.templateId",
    (r) => {
      r.document.responses["C-1"].adviceDraft!.templateId = "template-1";
    },
  ],
  [
    "advice.gap",
    (r) => {
      r.document.responses["C-1"].adviceDraft!.gap = "changed";
    },
  ],
  [
    "advice.steps",
    (r) => {
      r.document.responses["C-1"].adviceDraft!.steps = ["changed"];
    },
  ],
  [
    "advice.evidenceExamples",
    (r) => {
      r.document.responses["C-1"].adviceDraft!.evidenceExamples = ["changed"];
    },
  ],
  [
    "advice.completionCheck",
    (r) => {
      r.document.responses["C-1"].adviceDraft!.completionCheck = "changed";
    },
  ],
  [
    "advice.notes",
    (r) => {
      r.document.responses["C-1"].adviceDraft!.notes = "changed";
    },
  ],
  [
    "advice.field-boundary",
    (r) => {
      r.document.responses["C-1"].adviceDraft!.steps = ["one"];
      r.document.responses["C-1"].adviceDraft!.evidenceExamples = ["two"];
    },
  ],
  [
    "evidence.name",
    (r) => {
      r.document.evidence[0].name = "changed";
    },
  ],
  [
    "evidence.criterionIds",
    (r) => {
      r.document.evidence[0].criterionIds = ["C-1", "C-2"];
      r.document.evidence[0].reviews["C-2"] = review;
    },
  ],
  [
    "evidence.url",
    (r) => {
      r.document.evidence[0].url = "https://example.invalid/changed";
    },
  ],
  [
    "evidence.location",
    (r) => {
      r.document.evidence[0].location = "changed";
    },
  ],
  [
    "evidence.fileId",
    (r) => {
      r.document.evidence[0].fileId = uuid(99);
    },
  ],
  [
    "task.title",
    (r) => {
      r.document.tasks[0].title = "changed";
    },
  ],
  [
    "task.ownerName",
    (r) => {
      r.document.tasks[0].ownerName = "changed";
    },
  ],
  [
    "task.dueDate",
    (r) => {
      r.document.tasks[0].dueDate = "2026-10-02";
    },
  ],
  [
    "task.priority",
    (r) => {
      r.document.tasks[0].priority = "high";
    },
  ],
  [
    "task.completionCondition",
    (r) => {
      r.document.tasks[0].completionCondition = "changed";
    },
  ],
  [
    "task.evidenceIds",
    (r) => {
      r.document.tasks[0].evidenceIds = [uuid(3)];
    },
  ],
  [
    "diagnosisDate",
    (r) => {
      r.document.diagnosisDate = "2026-10-01";
    },
  ],
  [
    "advice.array-boundary",
    (r) => {
      r.document.responses["C-1"].adviceDraft!.steps = ["one\ntwo"];
    },
  ],
  [
    "task.state",
    (r) => {
      r.document.tasks[0].state = "doing";
    },
  ],
  [
    "task.result",
    (r) => {
      r.document.tasks[0].result = "報告";
    },
  ],
  [
    "task.sourceTaskId",
    (r) => {
      r.document.tasks[0].sourceTaskId = uuid(9);
    },
  ],
  [
    "task.sourceAssessmentId",
    (r) => {
      r.document.tasks[0].sourceAssessmentId = uuid(10);
    },
  ],
  ...(["note", "by", "at", "subjectHash", "state"] as const).flatMap((field) =>
    ["evidence", "task"].map(
      (kind) =>
        [
          `${kind}.review.${field}`,
          (r: AssessmentDto) => {
            const target = structuredClone(
              kind === "evidence"
                ? r.document.evidence[0].reviews["C-1"]
                : r.document.tasks[0].review,
            );
            if (kind === "evidence") r.document.evidence[0].reviews["C-1"] = target;
            else r.document.tasks[0].review = target;
            if (field === "note") target.note = "更新";
            if (field === "by") target.by = uuid(99);
            if (field === "at") target.at = "2026-10-01T00:00:00.000Z";
            if (field === "subjectHash") target.subjectHash = "b".repeat(64);
            if (field === "state") target.state = "rejected";
          },
        ] as [string, (r: AssessmentDto) => void],
    ),
  ),
];
describe("independent copy-source conflict field coverage", () => {
  it.each(cases)("%s", (name, change) => {
    const record = fixture(),
      latest = structuredClone(record);
    latest.revision = 2;
    change(latest);
    expect(assessmentDocumentSchema.safeParse(latest.document).success).toBe(true);
    const writer = {
      pending: false,
      error: null as Error | null,
      clearError: vi.fn(),
      send: vi.fn(async () => null),
    };
    const props = { readOnly: false, write: writer, onRefresh: vi.fn(), onCreated: vi.fn() };
    const rendered = render(<ReassessmentForm record={record} {...props} />);
    rendered.rerender(
      <ReassessmentForm
        record={latest}
        {...props}
        write={{
          ...writer,
          error: new ApiError(409, {
            error: { code: "CONFLICT", message: "競合" },
            requestId: "review-probe",
          }),
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "コピー元の変更を確認" })).toBeInTheDocument();
    const rows = screen.getByRole("table").querySelectorAll("tbody tr").length;
    expect(rows).toBe(name === "unchanged negative control" ? 0 : 1);
  });
});

function conflictCells(record: AssessmentDto, latest: AssessmentDto) {
  const writer = {
    pending: false,
    error: null as Error | null,
    clearError: vi.fn(),
    send: vi.fn(async () => null),
  };
  const props = { readOnly: false, write: writer, onRefresh: vi.fn(), onCreated: vi.fn() };
  const rendered = render(<ReassessmentForm record={record} {...props} />);
  rendered.rerender(
    <ReassessmentForm
      record={latest}
      {...props}
      write={{
        ...writer,
        error: new ApiError(409, {
          error: { code: "CONFLICT", message: "競合" },
          requestId: "review-probe",
        }),
      }}
    />,
  );
  expect(screen.getByRole("heading", { name: "コピー元の変更を確認" })).toBeInTheDocument();
  return Array.from(screen.getByRole("table").querySelectorAll("tbody tr"));
}
describe("structured source values in the conflict table", () => {
  it("distinguishes a single multiline advice step from two separate steps", () => {
    const source = fixture(),
      latest = structuredClone(source);
    latest.revision = 2;
    latest.document.responses["C-1"].adviceDraft!.steps = ["one\ntwo"];
    const [row] = conflictCells(source, latest);
    expect(
      within(row as HTMLElement)
        .getAllByRole("cell")
        .map((cell) =>
          Array.from(within(cell).getByRole("list", { name: "実施手順" }).children).map(
            (item) => item.textContent,
          ),
        ),
    ).toEqual([["one", "two"], ["one\ntwo"]]);
  });
  it("ignores object-key order and the order of evidence records with unchanged IDs and content", () => {
    const source = fixture();
    source.document.evidence[0].criterionIds.push("C-2");
    source.document.evidence[0].reviews["C-2"] = { ...review, note: "確認予定" };
    const latest = structuredClone(source);
    latest.revision = 2;
    latest.document.evidence[0].reviews = Object.fromEntries(
      Object.entries(latest.document.evidence[0].reviews).reverse(),
    );
    latest.document.evidence.reverse();
    expect(
      [source, latest].map((r) => assessmentDocumentSchema.safeParse(r.document).success),
    ).toEqual([true, true]);
    expect(conflictCells(source, latest).length).toBe(0);
  });
  it.each([
    "evidence-add",
    "evidence-remove",
    "task-add",
    "task-remove",
    "advice-remove",
    "confirmed-fallback",
  ])("shows %s as an explicit present/absent or advice-source change", (kind) => {
    const source = fixture(),
      latest = structuredClone(source);
    latest.revision = 2;
    if (kind === "evidence-add")
      latest.document.evidence.push({
        ...structuredClone(source.document.evidence[0]),
        id: uuid(30),
        name: "追加の証跡",
      });
    if (kind === "evidence-remove") latest.document.evidence.pop();
    if (kind === "task-add")
      latest.document.tasks.push({
        ...structuredClone(source.document.tasks[0]),
        id: uuid(30),
        title: "追加の課題",
      });
    if (kind === "task-remove") latest.document.tasks = [];
    if (kind === "advice-remove") latest.document.responses["C-1"].adviceDraft = null;
    if (kind === "confirmed-fallback") {
      latest.document.responses["C-1"].confirmedAdvice = {
        content: latest.document.responses["C-1"].adviceDraft!,
        basisHash: "a".repeat(64),
        by: uuid(1),
        at: "2026-10-01T00:00:00.000Z",
        version: 1,
      };
      latest.document.responses["C-1"].adviceDraft = null;
    }
    expect(assessmentDocumentSchema.safeParse(latest.document).success).toBe(true);
    const rows = conflictCells(source, latest);
    expect(rows.length).toBe(1);
    const cells = within(rows[0] as HTMLElement).getAllByRole("cell");
    if (kind === "confirmed-fallback")
      expect(
        cells.map((cell) => within(cell).getByText(/^(下書き|確定助言)$/).textContent),
      ).toEqual(["下書き", "確定助言"]);
    else
      expect(cells.map((cell) => cell.textContent === "なし")).toEqual(
        kind.endsWith("add") ? [true, false] : [false, true],
      );
  });
  it("shows the replaced attachment reference and task evidence reference with the original and latest identity", () => {
    const source = fixture(),
      latest = structuredClone(source);
    latest.revision = 2;
    latest.document.evidence[0].fileId = uuid(99);
    latest.document.tasks[0].evidenceIds = [uuid(3)];
    const rows = conflictCells(source, latest);
    expect(rows.length).toBe(2);
    const evidenceCells = within(rows[0] as HTMLElement).getAllByRole("cell");
    expect(
      evidenceCells.map(
        (cell) => within(cell).getByText(/00000000-0000-4000-8000-0000000000(12|99)/).textContent,
      ),
    ).toEqual([uuid(12), uuid(99)]);
    const taskCells = within(rows[1] as HTMLElement).getAllByRole("cell");
    expect(
      taskCells.map((cell) =>
        Array.from(within(cell).getByRole("list", { name: "関連する証跡" }).children).map(
          (item) => item.textContent,
        ),
      ),
    ).toEqual([[`証跡2（${uuid(2)}）`], [`証跡3（${uuid(3)}）`]]);
  });
  it("keeps advice fields and array-item boundaries visible when their concatenated text is identical", () => {
    const source = fixture(),
      latest = structuredClone(source);
    latest.revision = 2;
    latest.document.responses["C-1"].adviceDraft!.steps = ["one"];
    latest.document.responses["C-1"].adviceDraft!.evidenceExamples = ["two"];
    const [row] = conflictCells(source, latest);
    const cells = within(row as HTMLElement).getAllByRole("cell");
    expect(
      cells.map((cell) =>
        Array.from(within(cell).getByRole("list", { name: "実施手順" }).children).map(
          (item) => item.textContent,
        ),
      ),
    ).toEqual([["one", "two"], ["one"]]);
    expect(within(cells[1]).getByRole("list", { name: "証跡例" }).textContent).toBe("two");
  });
  it.each(["evidence", "task"])(
    "detects %s field-boundary shifts without displaying an identical flat value",
    (kind) => {
      const source = fixture();
      if (kind === "evidence") source.document.evidence[0].location = "C-1\n第1章";
      else source.document.tasks[0].title = "課題\n前";
      const latest = structuredClone(source);
      latest.revision = 2;
      if (kind === "evidence") {
        latest.document.evidence[0].name = "証跡2\nC-1";
        latest.document.evidence[0].location = "第1章";
      } else {
        latest.document.tasks[0].title = "課題";
        latest.document.tasks[0].ownerName = "前\n担当";
      }
      expect(
        [source, latest].map((r) => assessmentDocumentSchema.safeParse(r.document).success),
      ).toEqual([true, true]);
      const rows = conflictCells(source, latest);
      expect(rows.length).toBe(1);
      const cells = within(rows[0] as HTMLElement).getAllByRole("cell");
      expect(cells[0].textContent === cells[1].textContent).toBe(false);
    },
  );
});
