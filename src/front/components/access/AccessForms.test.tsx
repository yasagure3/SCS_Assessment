import { describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";
import { InviteForm, UserAccessForm, MembersForm } from "./AccessForms";
import { ApiError } from "../../lib/fetcher";
afterEach(cleanup);
const user = {
  id: "user",
  email: "staff@example.invalid",
  role: "staff" as const,
  status: "active" as const,
  revision: 1,
  customerIds: [],
};

describe("access-management form behavior", () => {
  it("uses refreshed user values and revision when the form has not been edited", async () => {
    const submit = vi.fn(async () => null),
      refresh = vi.fn();
    const view = render(
      <UserAccessForm user={user} submit={submit} pending={false} error={null} refresh={refresh} />,
    );
    view.rerender(
      <UserAccessForm
        user={{ ...user, revision: 2, role: "admin" }}
        submit={submit}
        pending={false}
        error={null}
        refresh={refresh}
      />,
    );
    expect(screen.getByLabelText("役割")).toHaveValue("admin");
    fireEvent.change(screen.getByLabelText("利用状態"), { target: { value: "suspended" } });
    fireEvent.click(screen.getByRole("button", { name: "利用者の変更を保存" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        expectedRevision: 2,
        role: "admin",
        status: "suspended",
      }),
    );
  });
  it("keeps an edited user's input and revision when a background refresh arrives", async () => {
    const submit = vi.fn(async () => null),
      refresh = vi.fn();
    const view = render(
      <UserAccessForm user={user} submit={submit} pending={false} error={null} refresh={refresh} />,
    );
    fireEvent.change(screen.getByLabelText("利用状態"), { target: { value: "suspended" } });
    view.rerender(
      <UserAccessForm
        user={{ ...user, revision: 2, role: "admin" }}
        submit={submit}
        pending={false}
        error={null}
        refresh={refresh}
      />,
    );
    expect(screen.getByLabelText("役割")).toHaveValue("staff");
    expect(screen.getByLabelText("利用状態")).toHaveValue("suspended");
    fireEvent.click(screen.getByRole("button", { name: "利用者の変更を保存" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        expectedRevision: 1,
        role: "staff",
        status: "suspended",
      }),
    );
  });
  it("uses refreshed assignments and revision before the first edit", async () => {
    const submit = vi.fn(async () => null),
      refresh = vi.fn();
    const view = render(
      <MembersForm
        members={{ customerId: "c", revision: 1, userIds: [] }}
        users={[user]}
        submit={submit}
        pending={false}
        error={null}
        refresh={refresh}
      />,
    );
    view.rerender(
      <MembersForm
        members={{ customerId: "c", revision: 2, userIds: ["other-page", "user"] }}
        users={[user]}
        submit={submit}
        pending={false}
        error={null}
        refresh={refresh}
      />,
    );
    expect(screen.getByLabelText("staff@example.invalid")).toBeChecked();
    fireEvent.click(screen.getByLabelText("staff@example.invalid"));
    fireEvent.click(screen.getByRole("button", { name: "顧客の割当を保存" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ expectedRevision: 2, userIds: ["other-page"] }),
    );
  });
  it("keeps edited assignments and their base revision across background refresh", async () => {
    const submit = vi.fn(async () => null),
      refresh = vi.fn();
    const view = render(
      <MembersForm
        members={{ customerId: "c", revision: 1, userIds: ["other-page"] }}
        users={[user]}
        submit={submit}
        pending={false}
        error={null}
        refresh={refresh}
      />,
    );
    fireEvent.click(screen.getByLabelText("staff@example.invalid"));
    view.rerender(
      <MembersForm
        members={{ customerId: "c", revision: 2, userIds: [] }}
        users={[user]}
        submit={submit}
        pending={false}
        error={null}
        refresh={refresh}
      />,
    );
    expect(screen.getByLabelText("staff@example.invalid")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "顧客の割当を保存" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ expectedRevision: 1, userIds: ["other-page", "user"] }),
    );
  });
  it("validates an invitation and keeps the entered recipient and assignments after provider failure", async () => {
    const submit = vi.fn(async () => false);
    const customerId = "00000000-0000-4000-8000-000000000001";
    render(
      <InviteForm
        customers={[{ id: customerId, name: "匿名会社" }]}
        submit={submit}
        pending={false}
        error={new Error("招待送信が失敗しました。")}
      />,
    );
    expect(screen.getByRole("button", { name: "招待メールを送信" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("社内メールアドレス"), {
      target: { value: "invite@example.invalid" },
    });
    fireEvent.click(screen.getByLabelText("匿名会社"));
    fireEvent.click(screen.getByRole("button", { name: "招待メールを送信" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        email: "invite@example.invalid",
        role: "staff",
        customerIds: [customerId],
      }),
    );
    expect(screen.getByLabelText("社内メールアドレス")).toHaveValue("invite@example.invalid");
    expect(screen.getByLabelText("匿名会社")).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("招待送信が失敗しました。");
  });
  it("prevents duplicate user updates and makes a conflict an explicit revision decision", async () => {
    const submit = vi.fn(async () => null),
      refresh = vi.fn();
    const view = render(
      <UserAccessForm user={user} submit={submit} pending={true} error={null} refresh={refresh} />,
    );
    expect(screen.getByRole("button", { name: "利用者の変更を保存" })).toBeDisabled();
    const conflict = new ApiError(409, {
      error: { code: "CONFLICT", message: "別の管理者が更新しました。" },
      requestId: "r",
    });
    view.rerender(
      <UserAccessForm
        user={{ ...user, revision: 2, role: "admin" }}
        submit={submit}
        pending={false}
        error={conflict}
        refresh={refresh}
      />,
    );
    fireEvent.change(screen.getByLabelText("利用状態"), { target: { value: "suspended" } });
    expect(screen.getByRole("button", { name: "利用者の変更を保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "入力を保って再編集する" }));
    fireEvent.click(screen.getByRole("button", { name: "利用者の変更を保存" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        expectedRevision: 2,
        role: "staff",
        status: "suspended",
      }),
    );
  });
  it("keeps off-page assignments and submits the latest customer revision only after explicit conflict confirmation", async () => {
    const submit = vi.fn(async () => null),
      refresh = vi.fn();
    const view = render(
      <MembersForm
        members={{ customerId: "c", revision: 1, userIds: ["other-page"] }}
        users={[user]}
        submit={submit}
        pending={false}
        error={null}
        refresh={refresh}
      />,
    );
    fireEvent.click(screen.getByLabelText("staff@example.invalid"));
    const conflict = new ApiError(409, {
      error: { code: "CONFLICT", message: "別の管理者が更新しました。" },
      requestId: "r",
    });
    view.rerender(
      <MembersForm
        members={{ customerId: "c", revision: 3, userIds: [] }}
        users={[user]}
        submit={submit}
        pending={false}
        error={conflict}
        refresh={refresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "入力を保って再編集する" }));
    fireEvent.click(screen.getByRole("button", { name: "顧客の割当を保存" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ expectedRevision: 3, userIds: ["other-page", "user"] }),
    );
  });
});
