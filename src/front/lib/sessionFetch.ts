import { mutate } from "swr";
import { getCurrentSession, getSessionGeneration, type Session } from "./cognitoClient";

// A 401 is a confirmed authentication rejection, so replay the same body and operation key
// only within the originating login, with a different memory-only token. Authorization is rechecked.
export function createSessionFetch(io: {
  fetch: typeof fetch;
  generation: () => number;
  session: () => Promise<Session | null>;
  updated?: (session: Session) => Promise<unknown>;
}): typeof fetch {
  let refreshing: { generation: number; promise: Promise<Session | null> } | null = null;
  return async (input, init) => {
    init?.signal?.throwIfAborted();
    const generation = io.generation();
    const current = () => generation === io.generation();
    const response = await io.fetch(input, init);
    init?.signal?.throwIfAborted();
    const headers = new Headers(init?.headers);
    const authorization = headers.get("Authorization");
    if (response.status !== 401 || !authorization?.startsWith("Bearer ")) return response;
    if (!current()) return response;
    // API calls supply replayable strings/ArrayBuffers; streamed Request bodies are excluded.
    if (input instanceof Request || init?.body instanceof ReadableStream) return response;
    if (!refreshing || refreshing.generation !== generation) {
      const promise = io.session().then(async (session) => {
        if (!current()) return null;
        if (session) await io.updated?.(session);
        return current() ? session : null;
      });
      const attempt = { generation, promise };
      refreshing = attempt;
      attempt.promise = promise.finally(() => {
        // An old SDK result must not clear the next login's shared refresh.
        if (refreshing === attempt) refreshing = null;
      });
    }
    const session = await refreshing.promise;
    init?.signal?.throwIfAborted();
    if (!current() || !session || authorization === `Bearer ${session.accessToken}`)
      return response;
    headers.set("Authorization", `Bearer ${session.accessToken}`);
    return io.fetch(input, { ...init, headers });
  };
}

export const sessionFetch = createSessionFetch({
  fetch: (...args) => fetch(...args),
  generation: getSessionGeneration,
  session: getCurrentSession,
  updated: (session) => mutate("cognito-session", session, { revalidate: false }),
});
