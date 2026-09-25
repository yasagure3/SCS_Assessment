// @vitest-environment node
import { expect, it } from "vitest";
import { performanceInputs } from "../live/performanceInputs";
import { addTaskSchema } from "../../src/shared/contracts/improvement";
import { addEvidenceSchema } from "../../src/shared/contracts/evidence";
import { editResponseSchema } from "../../src/shared/contracts/assessment";
import { confirmAdviceSchema } from "../../src/shared/contracts/advice";
import { membersSchema } from "../../src/shared/contracts/access";

it("builds maximum-report inputs accepted by every actual product write schema", () => {
  const mutation = { expectedRevision: 1, mutationId: crypto.randomUUID() },
    id = "1-2-1-1";
  const inputs = performanceInputs(id, 99, 3000, "no");
  expect(addTaskSchema.parse({ ...mutation, ...inputs.task }).priority).toBe("normal");
  expect(addEvidenceSchema.parse({ ...mutation, ...inputs.evidence }).criterionIds).toEqual([id]);
  expect(editResponseSchema.parse({ ...mutation, ...inputs.response }).reason).toBe(
    "記".repeat(3000),
  );
  expect(confirmAdviceSchema.parse({ ...mutation, ...inputs.advice }).reviewed).toBe(true);
  const userIds = [crypto.randomUUID()];
  expect(membersSchema.parse({ ...mutation, userIds })).toEqual({ ...mutation, userIds });
});
