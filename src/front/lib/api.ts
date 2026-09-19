import { useRef, useState } from "react";
import useSWR from "swr";
import type { ApiSuccess } from "../../shared/contracts/api";
import { getCurrentSession } from "./cognitoClient";
import { ApiError, fetcher } from "./fetcher";
export function isAccessError(error: unknown) {
  return error instanceof ApiError && [401, 403, 404].includes(error.status);
}
export function useApi<T>(path: string | null) {
  const { data: session } = useSWR("cognito-session", getCurrentSession);
  const result = useSWR<ApiSuccess<T>>(
    session && path ? [path, session.accessToken] : null,
    ([url, token]: [string, string]) =>
      fetcher<ApiSuccess<T>>(url, { headers: { Authorization: `Bearer ${token}` } }),
    { shouldRetryOnError: false },
  );
  return {
    ...result,
    data: result.data?.data,
    mutate: () => result.mutate().catch(() => undefined),
    replace: (response: ApiSuccess<T>) => result.mutate(response, { revalidate: false }),
  };
}
export function useWrite() {
  const { data: session } = useSWR("cognito-session", getCurrentSession);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const operation = useRef({ signature: "", key: "" });
  const busy = useRef(false);
  async function send<T>(
    path: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
  ): Promise<ApiSuccess<T> | null> {
    if (busy.current) return null;
    if (!session) {
      setError(new ApiError(401));
      return null;
    }
    const signature = JSON.stringify({ path, method, body });
    if (signature !== operation.current.signature)
      operation.current = { signature, key: crypto.randomUUID() };
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await fetcher<ApiSuccess<T>>(path, {
        method,
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": operation.current.key,
        },
        body: JSON.stringify(
          method === "PATCH" ? { ...body, mutationId: operation.current.key } : body,
        ),
      });
      operation.current = { signature: "", key: "" };
      return result;
    } catch (reason) {
      // A rejected key is known to belong to a different operation; retry only on the user's next save.
      // Unknown network outcomes retain their key so successful writes can be replayed safely.
      if (reason instanceof ApiError && reason.code === "IDEMPOTENCY_CONFLICT")
        operation.current = { signature: "", key: "" };
      setError(reason instanceof Error ? reason : new Error("通信を完了できませんでした。"));
      return null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { pending, error, send, clearError: () => setError(null) };
}
