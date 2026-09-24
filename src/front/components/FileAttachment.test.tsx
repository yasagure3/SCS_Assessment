import { describe, expect, it } from "vite-plus/test";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { FileAttachment } from "./FileAttachment";
import type { FileUploaded } from "../../shared/contracts/files";
import { ApiError } from "../lib/fetcher";
import { signOut } from "../lib/cognitoClient";
describe("file attachment", () => {
  it.each(["unmount", "logout"])("discards late successful completion after %s", async (end) => {
    const states: unknown[] = [];
    let finish!: (result: FileUploaded) => void;
    let signal!: AbortSignal;
    const view = render(
      <FileAttachment
        disabled={false}
        newId={() => "key"}
        onChange={(value) => states.push(value)}
        upload={async (_file, _key, requestedSignal) => {
          signal = requestedSignal;
          return new Promise<FileUploaded>((resolve) => {
            finish = resolve;
          });
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("添付ファイル（任意）"), {
      target: { files: [new File(["anonymous"], "anonymous.txt")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "添付ファイルを登録" }));
    if (end === "unmount") view.unmount();
    else signOut();
    await act(async () => {
      finish({ fileId: "late-id", status: "ready", sizeBytes: 9, sha256: "ab".repeat(32) });
    });
    expect({ states, aborted: signal.aborted }).toEqual({
      states: [
        { fileId: null, pending: false, incomplete: true },
        { fileId: null, pending: true, incomplete: true },
      ],
      aborted: true,
    });
  });
  it("requires a new selection after a confirmed rejection", async () => {
    render(
      <FileAttachment
        disabled={false}
        newId={() => "key"}
        onChange={() => {}}
        upload={async () => {
          throw new ApiError(422, {
            error: { code: "FILE_INVALID", message: "形式を確認してください。" },
            requestId: "request",
          });
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("添付ファイル（任意）"), {
      target: { files: [new File(["x"], "a.pdf")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "添付ファイルを登録" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("形式を確認してください。");
    expect(screen.getByRole("button", { name: "添付ファイルを登録" })).toBeDisabled();
  });
  it("preserves the selected file and retry key after a network failure, then exposes only a ready ID", async () => {
    const states: unknown[] = [],
      calls: string[] = [],
      file = new File(["anonymous"], "anonymous.txt", { type: "text/plain" });
    render(
      <FileAttachment
        disabled={false}
        newId={() => "attempt-1"}
        onChange={(state) => states.push(state)}
        upload={async (_file, key) => {
          calls.push(key);
          if (calls.length === 1) throw new Error("通信が切断されました。");
          return { fileId: "file-1", status: "ready", sizeBytes: 9, sha256: "a".repeat(64) };
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("添付ファイル（任意）"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "添付ファイルを登録" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("通信が切断されました。");
    expect(screen.getByText("anonymous.txt")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "添付ファイルを登録" }));
    expect(await screen.findByText("添付の登録が完了しました。内容は未確認です。")).toBeVisible();
    expect(calls).toEqual(["attempt-1", "attempt-1"]);
    expect(states.at(-1)).toEqual({ fileId: "file-1", pending: false, incomplete: false });
  });
  it.each(["uploading", "rejected"] as const)(
    "requires reselection for a %s upload and never exposes its ID",
    async (status) => {
      const states: unknown[] = [];
      const result: FileUploaded = {
        fileId: "private-id",
        status,
        sizeBytes: 0,
        sha256: "0".repeat(64),
      };
      render(
        <FileAttachment
          disabled={false}
          newId={() => "key"}
          onChange={(state) => states.push(state)}
          upload={async () => result}
        />,
      );
      fireEvent.change(screen.getByLabelText("添付ファイル（任意）"), {
        target: { files: [new File(["x"], "a.txt")] },
      });
      fireEvent.click(screen.getByRole("button", { name: "添付ファイルを登録" }));
      await screen.findByRole("alert");
      expect(screen.getByRole("button", { name: "添付ファイルを登録" })).toBeDisabled();
      expect(states.at(-1)).toEqual({ fileId: null, pending: false, incomplete: true });
    },
  );
  it("rejects oversized input before sending and cancels an in-flight upload", async () => {
    let calls = 0,
      aborted = false;
    render(
      <FileAttachment
        disabled={false}
        newId={() => "key"}
        onChange={() => {}}
        upload={async (_file, _key, signal) => {
          calls++;
          return new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("cancelled"));
            }),
          );
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("添付ファイル（任意）"), {
      target: { files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.txt")] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("ファイルは10MiB以下にしてください。");
    expect(calls).toBe(0);
    fireEvent.change(screen.getByLabelText("添付ファイル（任意）"), {
      target: { files: [new File(["x"], "a.txt")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "添付ファイルを登録" }));
    fireEvent.click(screen.getByRole("button", { name: "送信を中止" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "送信を中止しました。ファイルを選び直してください。",
      ),
    );
    expect({ calls, aborted }).toEqual({ calls: 1, aborted: true });
  });
});
