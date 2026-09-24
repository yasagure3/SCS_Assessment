import { describe, expect, it } from "vite-plus/test";
import { createSessionFetch } from "./sessionFetch";
import type { Session } from "./cognitoClient";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const families = [
  { name: "read", path: "/api/v1/customers", method: "GET", body: undefined },
  { name: "JSON write", path: "/api/v1/customers", method: "POST", body: '{"name":"匿名社"}' },
  {
    name: "file upload",
    path: "/api/v1/files/upload",
    method: "PUT",
    body: new Uint8Array([10, 20, 30]).buffer,
  },
] as const;
const boundaries = ["initial HTTP", "SDK refresh", "session publication"] as const;
const transitions = [
  "normal refresh",
  "logout",
  "same-user login",
  "different-user login",
] as const;
const cases = families.flatMap((family) =>
  boundaries.flatMap((boundary) =>
    transitions.map((transition) => ({
      ...family,
      boundary,
      transition,
    })),
  ),
);

describe("HTTP refresh stays within its originating login", () => {
  it.each(cases)(
    "$name during $boundary with $transition",
    async ({ path, method, body, boundary, transition }) => {
      let generation = 1,
        refreshes = 0;
      let current: Session | null = { accessToken: "fresh", email: "same@example.invalid" };
      const reached = deferred<void>(),
        release = deferred<void>();
      const published: Session[] = [];
      const calls: {
        path: RequestInfo | URL;
        method: string | undefined;
        authorization: string | null;
        key: string | null;
        body: BodyInit | null | undefined;
      }[] = [];
      async function pause(at: (typeof boundaries)[number]) {
        if (at === boundary) {
          reached.resolve();
          await release.promise;
        }
      }
      const request = createSessionFetch({
        generation: () => generation,
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers);
          calls.push({
            path: url,
            method: init?.method,
            authorization: headers.get("Authorization"),
            key: headers.get("Idempotency-Key"),
            body: init?.body,
          });
          if (calls.length === 1) {
            await pause("initial HTTP");
            return Response.json({ denied: true }, { status: 401 });
          }
          return Response.json({ saved: true });
        },
        session: async () => {
          refreshes++;
          await pause("SDK refresh");
          return current;
        },
        updated: async (session) => {
          published.push(session);
          await pause("session publication");
        },
      });
      const pending = request(path, {
        method,
        body,
        headers: { Authorization: "Bearer expired", "Idempotency-Key": "original-operation" },
      });
      await reached.promise;
      if (transition !== "normal refresh") {
        generation++;
        current = null;
        if (transition !== "logout") {
          generation++;
          current = {
            accessToken: "new-login-token",
            email:
              transition === "same-user login" ? "same@example.invalid" : "other@example.invalid",
          };
        }
      }
      release.resolve();
      const response = await pending;
      const normal = transition === "normal refresh";
      const original = {
        path,
        method,
        authorization: "Bearer expired",
        key: "original-operation",
        body,
      };
      expect({
        status: response.status,
        body: await response.json(),
        calls,
        refreshes,
        published,
      }).toEqual({
        status: normal ? 200 : 401,
        body: normal ? { saved: true } : { denied: true },
        calls: normal ? [original, { ...original, authorization: "Bearer fresh" }] : [original],
        refreshes: !normal && boundary === "initial HTTP" ? 0 : 1,
        published:
          normal || boundary === "session publication"
            ? [{ accessToken: "fresh", email: "same@example.invalid" }]
            : [],
      });
    },
  );

  it("does not share or clear a new login's in-flight refresh when an older refresh finishes", async () => {
    let generation = 1,
      refreshes = 0;
    const old = deferred<Session>(),
      next = deferred<Session>();
    const oldStarted = deferred<void>(),
      nextStarted = deferred<void>();
    const thirdArrived = deferred<void>();
    const published: Session[] = [];
    const calls: { path: RequestInfo | URL; authorization: string | null }[] = [];
    const request = createSessionFetch({
      generation: () => generation,
      fetch: async (path, init) => {
        const authorization = new Headers(init?.headers).get("Authorization");
        calls.push({ path, authorization });
        if (path === "/new-third" && authorization === "Bearer new-expired") thirdArrived.resolve();
        return Response.json(
          { authorized: authorization === "Bearer new-fresh" },
          { status: authorization === "Bearer new-fresh" ? 200 : 401 },
        );
      },
      session: () => {
        refreshes++;
        if (refreshes === 1) {
          oldStarted.resolve();
          return old.promise;
        }
        nextStarted.resolve();
        return next.promise;
      },
      updated: async (session) => {
        published.push(session);
      },
    });
    const previous = request("/old", { headers: { Authorization: "Bearer old-expired" } });
    await oldStarted.promise;
    generation++;
    const first = request("/new-first", { headers: { Authorization: "Bearer new-expired" } });
    // Do not wait for nextStarted here: the unfixed implementation incorrectly joins old.
    await Promise.resolve();
    old.resolve({ accessToken: "old-fresh", email: "old@example.invalid" });
    expect({ status: (await previous).status, published }).toEqual({ status: 401, published: [] });
    await nextStarted.promise;
    const third = request("/new-third", { headers: { Authorization: "Bearer new-expired" } });
    await thirdArrived.promise;
    next.resolve({ accessToken: "new-fresh", email: "new@example.invalid" });
    const completed = await Promise.all([first, third]);
    expect({
      statuses: completed.map((response) => response.status),
      refreshes,
      published,
      calls,
    }).toEqual({
      statuses: [200, 200],
      refreshes: 2,
      published: [{ accessToken: "new-fresh", email: "new@example.invalid" }],
      calls: [
        { path: "/old", authorization: "Bearer old-expired" },
        { path: "/new-first", authorization: "Bearer new-expired" },
        { path: "/new-third", authorization: "Bearer new-expired" },
        { path: "/new-first", authorization: "Bearer new-fresh" },
        { path: "/new-third", authorization: "Bearer new-fresh" },
      ],
    });
  });
});
