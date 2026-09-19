import { describe, expect, it, vi } from "vite-plus/test";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ApiError } from "../lib/fetcher";
import { CasePage } from "./CasePage";
import { DashboardPage } from "./DashboardPage";
import { CustomerPage } from "./CustomerPage";
import { CustomersPage } from "./CustomersPage";
import { assessmentFixture } from "../components/assessments/assessmentFixtures";
import { CriteriaPage } from "./CriteriaPage";
import { CriterionPage } from "./CriterionPage";
const state = vi.hoisted(() => ({ error: undefined as unknown, failedPath: "all" }));
vi.mock("../lib/api", async (original) => {
  const real = await original<typeof import("../lib/api")>();
  return {
    ...real,
    useWrite: () => ({ pending: false, error: null, send: vi.fn(), clearError: vi.fn() }),
    useApi: (path: string) => {
      const customer = {
        id: "c",
        name: "顧客秘匿名",
        revision: 1,
        archivedAt: null,
        createdAt: "2026-09-19T00:00:00Z",
        updatedAt: "2026-09-19T00:00:00Z",
      };
      const record = { ...customer, id: "k", name: "案件秘匿名", customerId: "c" };
      const assessment = {
        ...assessmentFixture().record,
        id: "a",
        caseId: "k",
        customerId: "c",
        revision: 1,
      };
      const data = path?.startsWith("/api/v1/standards/")
        ? assessmentFixture().standard
        : path?.startsWith("/api/v1/assessments/")
          ? assessment
          : path?.startsWith("/api/v1/customers?q=")
            ? { items: [customer], nextCursor: null }
            : path?.endsWith("/assessments") || path?.endsWith("/cases")
              ? { items: [], nextCursor: null }
              : path?.startsWith("/api/v1/cases/")
                ? record
                : customer;
      return {
        data,
        error: state.failedPath === "all" || path === state.failedPath ? state.error : undefined,
        isLoading: false,
        mutate: vi.fn(),
        replace: vi.fn(),
      };
    },
  };
});
describe("cached labels after access failure", () => {
  it.each([401, 403, 404])("hides cached labels on all four C01 pages after %s", (status) => {
    const results: { page: string; path: string; before: boolean; after: boolean }[] = [];
    const pages = [
      ["CustomersPage", CustomersPage, ["all", "/api/v1/customers?q="]],
      [
        "CustomerPage",
        CustomerPage,
        ["all", "/api/v1/customers/undefined", "/api/v1/customers/undefined/cases"],
      ],
      [
        "CasePage",
        CasePage,
        [
          "all",
          "/api/v1/cases/undefined",
          "/api/v1/customers/c",
          "/api/v1/cases/undefined/assessments",
        ],
      ],
      [
        "DashboardPage",
        DashboardPage,
        [
          "all",
          "/api/v1/assessments/undefined",
          "/api/v1/cases/k",
          "/api/v1/customers/c",
          "/api/v1/standards/standard",
        ],
      ],
      [
        "CriteriaPage",
        CriteriaPage,
        [
          "all",
          "/api/v1/assessments/undefined",
          "/api/v1/cases/k",
          "/api/v1/customers/c",
          "/api/v1/standards/standard",
        ],
      ],
      [
        "CriterionPage",
        CriterionPage,
        [
          "all",
          "/api/v1/assessments/undefined",
          "/api/v1/cases/k",
          "/api/v1/customers/c",
          "/api/v1/standards/standard",
        ],
      ],
    ] as const;
    for (const [name, Page, paths] of pages)
      for (const path of paths) {
        state.failedPath = path;
        state.error = undefined;
        const view = render(
          <MemoryRouter>
            <Page />
          </MemoryRouter>,
        );
        const before = view.container.textContent!.includes(
          name === "DashboardPage" ? "案件秘匿名" : "顧客秘匿名",
        );
        state.error = new ApiError(status, {
          error: { code: "NOT_FOUND", message: "権限エラー" },
          requestId: "review",
        });
        view.rerender(
          <MemoryRouter>
            <Page />
          </MemoryRouter>,
        );
        expect(screen.getByRole("alert").textContent).toBe("権限エラー");
        const breadcrumb = view.container.querySelector(".breadcrumb");
        if (breadcrumb) expect(breadcrumb.getAttribute("href")).toBe("/customers");
        const after =
          view.container.textContent!.includes("顧客秘匿名") ||
          view.container.textContent!.includes("案件秘匿名");
        results.push({ page: name, path, before, after });
        cleanup();
      }
    expect(results).toEqual(
      pages.flatMap(([page, , paths]) =>
        paths.map((path) => ({
          page,
          path,
          before: true,
          after: false,
        })),
      ),
    );
  });
});
