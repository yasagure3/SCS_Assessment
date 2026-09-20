import type { ApiFailure } from "../../shared/contracts/api";
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly runId?: string;
  constructor(status: number, body?: ApiFailure) {
    super(body?.error?.message ?? "通信を完了できませんでした。もう一度お試しください。");
    this.status = status;
    this.code = body?.error?.code ?? "REQUEST_FAILED";
    this.requestId = body?.requestId ?? "";
    this.runId = body?.error?.runId;
  }
}
export async function fetcher<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiFailure | undefined;
    throw new ApiError(response.status, body);
  }
  return response.json();
}
