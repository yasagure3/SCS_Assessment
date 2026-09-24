import type { ApiFailure } from "../../shared/contracts/api";
import { sessionFetch } from "./sessionFetch";
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly runId?: string;
  readonly hasApiFailureResponse: boolean;
  constructor(status: number, body?: ApiFailure) {
    super(body?.error?.message ?? "通信を完了できませんでした。もう一度お試しください。");
    this.status = status;
    this.code = body?.error?.code ?? "REQUEST_FAILED";
    this.requestId = body?.requestId ?? "";
    this.runId = body?.error?.runId;
    this.hasApiFailureResponse =
      typeof body?.error?.code === "string" &&
      body.error.code.trim().length > 0 &&
      typeof body.error.message === "string" &&
      body.error.message.trim().length > 0 &&
      typeof body.requestId === "string" &&
      body.requestId.trim().length > 0;
  }
}
export function isUnknownWriteOutcome(error: Error | null): boolean {
  if (!error) return false;
  if (!(error instanceof ApiError)) return true;
  // Access and explicit conflicts must retain their normal restrictions even without a body.
  if (
    [401, 403, 404, 409].includes(error.status) ||
    ["CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error.code)
  )
    return false;
  // A server failure can occur after commit; an incomplete response cannot prove rejection.
  return error.status >= 500 || !error.hasApiFailureResponse;
}
export async function fetcher<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(url, { ...init, cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiFailure | undefined;
    throw new ApiError(response.status, body);
  }
  return response.json();
}
