import { useRef, useState } from "react";
import useSWR from "swr";
import type { ApiSuccess } from "../../shared/contracts/api";
import { getCurrentSession } from "./cognitoClient";
import { ApiError, fetcher } from "./fetcher";
export function isAccessError(error: unknown) {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}
export function useApi<T>(
  path: string | null,
  options: {
    dedupingInterval?: number;
    refreshInterval?: number;
    revalidateOnMount?: boolean;
    revalidateOnFocus?: boolean;
    revalidateOnReconnect?: boolean;
    onSuccess?: (response: ApiSuccess<T>) => void;
  } = {},
) {
  const { data: session } = useSWR("cognito-session", getCurrentSession);
  const { onSuccess, ...swrOptions } = options;
  // Keep same-resource forms mounted while a refreshed token is checked. The path tag
  // prevents showing the previous customer's data when the resource itself changes.
  const result = useSWR<{ path: string; response: ApiSuccess<T> }>(
    session && path ? [path, session.accessToken] : null,
    async ([url, token]: [string, string]) => ({
      path: url,
      response: await fetcher<ApiSuccess<T>>(url, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    }),
    {
      shouldRetryOnError: false,
      keepPreviousData: true,
      ...swrOptions,
      onSuccess: (value) => onSuccess?.(value.response),
    },
  );
  return {
    ...result,
    data: result.data?.path === path ? result.data.response.data : undefined,
    mutate: async () => (await result.mutate().catch(() => undefined))?.response,
    replace: async (response: ApiSuccess<T>) =>
      (await result.mutate(path ? { path, response } : undefined, { revalidate: false }))?.response,
  };
}
export function useWrite() {
  const { data: session } = useSWR("cognito-session", getCurrentSession);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const operations = useRef(new Map<string, string>());
  const busy = useRef(false);
  async function send<T>(
    path: string,
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    body: Record<string, unknown>,
    options?: { newAttemptOnConfirmedFailure?: boolean; readOnly?: boolean; operationKey?: string },
  ): Promise<ApiSuccess<T> | null> {
    if (busy.current) return null;
    if (!session) {
      setError(new ApiError(401));
      return null;
    }
    const signature = JSON.stringify({ path, method, body });
    const key = options?.operationKey ?? operations.current.get(signature) ?? crypto.randomUUID();
    operations.current.set(signature, key);
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await fetcher<ApiSuccess<T>>(path, {
        method,
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify(
          !options?.readOnly && (method !== "POST" || "expectedRevision" in body)
            ? { ...body, mutationId: key }
            : body,
        ),
      });
      operations.current.delete(signature);
      return result;
    } catch (reason) {
      // Unknown network outcomes retain their key; only confirmed rejection starts a new attempt.
      if (reason instanceof ApiError && reason.code === "IDEMPOTENCY_CONFLICT")
        operations.current.delete(signature);
      if (
        options?.newAttemptOnConfirmedFailure &&
        reason instanceof ApiError &&
        reason.requestId &&
        ((reason.status === 502 && reason.code === "PROVIDER_FAILED") ||
          (reason.status === 503 && reason.code === "SERVICE_UNAVAILABLE") ||
          (reason.status === 504 && reason.code === "PROVIDER_TIMEOUT"))
      )
        operations.current.delete(signature);
      setError(reason instanceof Error ? reason : new Error("通信を完了できませんでした。"));
      return null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function read<T>(path: string): Promise<ApiSuccess<T>> {
    if (!session) throw new ApiError(401);
    return fetcher<ApiSuccess<T>>(path, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
  }
  return { pending, error, send, read, clearError: () => setError(null) };
}
