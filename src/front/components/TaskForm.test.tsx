import { describe, expect, it } from "vite-plus/test";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskForm } from "./TaskForm";
import { assessmentFixture } from "./assessments/assessmentFixtures";

describe("task form", () => {
  it("requires owner, due date and completion condition before creating a task", () => {
    const { record, standard } = assessmentFixture();
    render(
      <TaskForm
        record={record}
        standard={standard}
        selection={{ item: null }}
        readOnly={false}
        write={{ pending: false, error: null, clearError: () => {}, send: async () => null }}
        onSaved={() => {}}
        onRefresh={() => {}}
        onCancel={() => {}}
      />,
    );
    const save = screen.getByRole("button", { name: "課題を保存" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("課題名"), { target: { value: "規程整備" } });
    fireEvent.change(screen.getByLabelText("関連する評価基準"), { target: { value: "C-1" } });
    fireEvent.change(screen.getByLabelText("担当者名"), { target: { value: "匿名担当者" } });
    fireEvent.change(screen.getByLabelText("期日（日本時間）"), {
      target: { value: "2026-09-20" },
    });
    fireEvent.change(screen.getByLabelText("完了条件"), { target: { value: "実施記録を照合" } });
    expect(save).toBeEnabled();
  });
});
