import { describe, expect, it, vi } from "vite-plus/test";
import { ApiError, fetcher, isUnknownWriteOutcome } from "./fetcher";

const refusal = {
  error: { code: "VALIDATION_ERROR", message: "入力内容を確認してください。" },
  requestId: "application-request",
};
describe("write outcome classification", () => {
  it.each([
    ["complete validation refusal", 422, refusal, false],
    [
      "complete size refusal",
      413,
      { ...refusal, error: { ...refusal.error, code: "PAYLOAD_TOO_LARGE" } },
      false,
    ],
    [
      "complete rate refusal",
      429,
      { ...refusal, error: { ...refusal.error, code: "RATE_LIMIT" } },
      false,
    ],
    ["requestId only", 422, { requestId: "proxy-request" }, true],
    [
      "missing error message",
      422,
      { error: { code: "VALIDATION_ERROR" }, requestId: "proxy-request" },
      true,
    ],
    [
      "missing error code",
      422,
      { error: { message: "partial" }, requestId: "proxy-request" },
      true,
    ],
    ["missing requestId", 422, { error: refusal.error }, true],
    ["blank requestId", 422, { ...refusal, requestId: " " }, true],
    ["wrong requestId type", 422, { ...refusal, requestId: 1 }, true],
    [
      "wrong message type",
      422,
      { ...refusal, error: { code: "VALIDATION_ERROR", message: 1 } },
      true,
    ],
    ["empty JSON", 422, null, true],
    [
      "server failure after a possible commit",
      500,
      { ...refusal, error: { ...refusal.error, code: "INTERNAL_ERROR" } },
      true,
    ],
    ["gateway failure", 502, null, true],
    ["unavailable response", 503, { requestId: "proxy-request" }, true],
    ["gateway timeout", 504, null, true],
    ["unauthorized without API body", 401, null, false],
    ["forbidden without API body", 403, null, false],
    ["not found without API body", 404, null, false],
    ["conflict without API body", 409, null, false],
    [
      "explicit conflict without requestId",
      502,
      { error: { ...refusal.error, code: "CONFLICT" } },
      false,
    ],
    [
      "explicit key conflict without requestId",
      502,
      { error: { ...refusal.error, code: "IDEMPOTENCY_CONFLICT" } },
      false,
    ],
  ] as const)("classifies %s through the product fetcher", async (_name, status, body, unknown) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status })),
    );
    const error = await fetcher("/api/v1/fixture").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(isUnknownWriteOutcome(error as ApiError)).toBe(unknown);
  });
  it("keeps invalid JSON outcomes unknown and has no retry without an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{")),
    );
    const error = await fetcher("/api/v1/fixture").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SyntaxError);
    expect([isUnknownWriteOutcome(error as Error), isUnknownWriteOutcome(null)]).toEqual([
      true,
      false,
    ]);
  });
});
