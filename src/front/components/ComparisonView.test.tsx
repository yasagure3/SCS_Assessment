import { describe, expect, it } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ComparisonView } from "./ComparisonView";
import { assessmentFixture } from "./assessments/assessmentFixtures";
import type { ComparisonDto } from "../../shared/contracts/improvement";

describe("comparison presentation", () => {
  it("labels both revisions, scope and edition differences and keeps the uncertain transition neutral", () => {
    const { record } = assessmentFixture();
    const data: ComparisonDto = {
      current: { ...record, revision: 3 },
      previous: { ...record, id: "previous", revision: 2, standardId: "旧版" },
      scopeChanges: [{ field: "sites", before: "本社", after: "全拠点" }],
      standardChanged: true,
      unmatchedIds: { previous: ["old"], current: ["new"] },
      rows: [
        {
          criterionId: "C-1",
          beforeStatus: "no",
          afterStatus: "uncertain",
          changed: true,
          responseChanges: [{ field: "reason", before: "前回回答", after: "今回回答" }],
          tasks: {
            mode: "unmatched",
            matched: [],
            notCarried: [],
            added: [],
            previous: [],
            current: [],
          },
        },
      ],
    };
    render(
      <MemoryRouter>
        <ComparisonView data={data} />
      </MemoryRouter>,
    );
    expect(screen.getByText("今回 revision 3 / 前回 revision 2")).toBeInTheDocument();
    expect(
      screen.getByText("制度版が異なります。基準IDが一致する項目のみ比較しています。"),
    ).toBeInTheDocument();
    expect(screen.getByText("対象拠点: 本社 → 全拠点")).toBeInTheDocument();
    expect(screen.getByText("✖ 不足 → △ 判断微妙")).toBeInTheDocument();
    expect(screen.getByText("前回回答 → 今回回答")).toBeInTheDocument();
    expect(
      screen.getByText(
        "課題は対応付けなし。直接のコピー元ではないため、前回・今回の一覧を表示します。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("対応する基準なし — 前回: old / 今回: new")).toBeInTheDocument();
  });
});
