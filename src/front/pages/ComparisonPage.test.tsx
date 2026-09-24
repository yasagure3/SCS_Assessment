import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SWRConfig, useSWRConfig } from "swr";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ComparisonPage } from "./ComparisonPage";
import { assessmentFixture } from "../components/assessments/assessmentFixtures";
import { STANDARD_ID } from "../../shared/contracts/assessment";
const id = "11111111-1111-4111-8111-111111111111",
  previousId = "22222222-2222-4222-8222-222222222222";
function fixture(hasPrevious = true) {
  const { record, standard } = assessmentFixture();
  record.id = id;
  record.standardId = STANDARD_ID;
  if (hasPrevious) record.document.copiedFrom = { assessmentId: previousId, revision: 2 };
  let fail = true;
  let comparisonDelay: Promise<void> | undefined;
  const urls: string[] = [];
  const returnedRevisions: number[] = [];
  // Only the external HTTP boundary is replaced; the page, SWR and mutation hook are real.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("/comparison?")) {
        await comparisonDelay;
        if (fail) throw new Error("比較を取得できませんでした。");
        returnedRevisions.push(record.revision);
        return Response.json({
          data: {
            current: record,
            previous: {
              ...record,
              id: previousId,
              revision: url.includes("previousRevision=4") ? 4 : 2,
            },
            scopeChanges: [],
            standardChanged: false,
            rows: [
              {
                criterionId: "C-1",
                beforeStatus: "no",
                afterStatus: record.document.responses["C-1"].status,
                changed: record.document.responses["C-1"].status !== "no",
                responseChanges: [],
                tasks: {
                  mode: "matched",
                  matched: [],
                  notCarried: [],
                  added: [],
                  previous: [],
                  current: [],
                },
              },
            ],
            unmatchedIds: { current: [], previous: [] },
          },
        });
      }
      if (url.endsWith("/standards/" + STANDARD_ID)) return Response.json({ data: standard });
      if (url.endsWith("/cases/case/assessments"))
        return Response.json({
          data: {
            items: hasPrevious
              ? [{ id: previousId, revision: 4, diagnosisDate: "2026-09-01" }]
              : [],
            nextCursor: null,
          },
        });
      if (url.endsWith("/cases/case"))
        return Response.json({ data: { id: "case", name: "案件", archivedAt: null } });
      if (url.endsWith("/customers/customer"))
        return Response.json({ data: { id: "customer", name: "匿名社", archivedAt: null } });
      return Response.json({ data: record });
    }),
  );
  return {
    urls,
    returnedRevisions,
    update: (revision: number, status: "uncertain" | "yes") => {
      record.revision = revision;
      record.document.responses["C-1"].status = status;
    },
    delayComparison: (delay: Promise<void> | undefined) => {
      comparisonDelay = delay;
    },
    succeed: () => {
      fail = false;
    },
  };
}
function CacheRefresh() {
  const { mutate } = useSWRConfig();
  return (
    <button
      onClick={() =>
        void mutate([`/api/v1/assessments/${id}/comparison?previous=${previousId}`, "test"])
      }
    >
      バックグラウンド再取得
    </button>
  );
}
function mount() {
  const router = createMemoryRouter(
    [
      { path: "/assessments/:assessmentId/comparison", element: <ComparisonPage /> },
      { path: "/elsewhere", element: <h1>別画面</h1> },
    ],
    { initialEntries: [`/assessments/${id}/comparison`] },
  );
  return {
    router,
    ...render(
      <SWRConfig
        value={{
          provider: () => new Map([["cognito-session", { data: { accessToken: "test" } }]]),
          dedupingInterval: 0,
          revalidateIfStale: false,
          revalidateOnFocus: false,
        }}
      >
        <CacheRefresh />
        <RouterProvider router={router} />
      </SWRConfig>,
    ),
  };
}
describe("comparison page loading and selection", () => {
  it("fetches a fresh pair after returning to the page and freezes it until the next explicit comparison", async () => {
    const f = fixture();
    f.succeed();
    const { router } = mount();
    await screen.findByText("今回 revision 1 / 前回 revision 2");
    await act(async () => {
      await router.navigate("/elsewhere");
    });
    expect(screen.getByRole("heading", { name: "別画面" })).toBeInTheDocument();
    f.update(2, "uncertain");
    let release!: () => void;
    f.delayComparison(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await act(async () => {
      await router.navigate(`/assessments/${id}/comparison`);
    });
    await waitFor(() =>
      expect(f.urls.filter((url) => url.includes("/comparison?")).length).toBe(2),
    );
    expect(screen.getByRole("status").textContent).toBe("読み込んでいます…");
    expect(screen.queryByText("今回 revision 1 / 前回 revision 2")).not.toBeInTheDocument();
    await act(async () => {
      release();
    });
    await screen.findByText("今回 revision 2 / 前回 revision 2");
    expect(screen.getByText("✖ 不足 → △ 判断微妙")).toBeInTheDocument();
    f.delayComparison(undefined);
    f.update(3, "yes");
    fireEvent.click(screen.getByRole("button", { name: "バックグラウンド再取得" }));
    await waitFor(() => expect(f.returnedRevisions).toEqual([1, 2, 3]));
    expect(screen.getByText("今回 revision 2 / 前回 revision 2")).toBeInTheDocument();
    expect(screen.getByText("✖ 不足 → △ 判断微妙")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "この組み合わせで比較" }));
    await screen.findByText("今回 revision 3 / 前回 revision 2");
    expect(screen.getByText("✖ 不足 → ○ 満たしている")).toBeInTheDocument();
    expect(f.returnedRevisions).toEqual([1, 2, 3, 3]);
  });
  it("shows loading and a retryable comparison failure then requests an explicit previous revision", async () => {
    const f = fixture();
    mount();
    expect(screen.getByRole("status").textContent).toBe("読み込んでいます…");
    expect((await screen.findByRole("alert")).textContent).toBe("比較を取得できませんでした。");
    f.succeed();
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(await screen.findByText("今回 revision 1 / 前回 revision 2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("前回revision（空欄はコピー時の版、その他は最新）"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "この組み合わせで比較" }));
    await screen.findByText("今回 revision 1 / 前回 revision 4");
    expect(f.urls.filter((url) => url.includes("/comparison?"))).toEqual([
      `/api/v1/assessments/${id}/comparison?previous=${previousId}`,
      `/api/v1/assessments/${id}/comparison?previous=${previousId}`,
      `/api/v1/assessments/${id}/comparison?previous=${previousId}&previousRevision=4`,
    ]);
  });
  it("shows the reassessment path when no previous diagnosis exists", async () => {
    const f = fixture(false);
    mount();
    await screen.findByText(
      "前回の診断がありません。下のフォームから新しい診断時点を作成できます。",
    );
    expect(screen.getByRole("button", { name: "この組み合わせで比較" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "再診断を作成" })).toBeEnabled());
    expect(f.urls.filter((url) => url.includes("/comparison?"))).toEqual([]);
  });
});
