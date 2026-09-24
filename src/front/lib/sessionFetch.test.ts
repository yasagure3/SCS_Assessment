import { describe, expect, it } from "vite-plus/test";
import { createSessionFetch } from "./sessionFetch";

describe("session refresh at the HTTP boundary", () => {
  it("shares one SDK refresh for simultaneous 401 responses and publishes the new session", async () => {
    let resolve!: (value: { accessToken: string; email: string }) => void;
    const session = new Promise<{ accessToken: string; email: string }>((complete) => {
      resolve = complete;
    });
    let refreshes = 0;
    const published: unknown[] = [];
    const request = createSessionFetch({
      generation: () => 1,
      session: () => {
        refreshes++;
        return session;
      },
      updated: async (value) => {
        published.push(value);
      },
      fetch: async (_url, init) =>
        Response.json(
          { authorized: new Headers(init?.headers).get("Authorization") === "Bearer fresh" },
          {
            status: new Headers(init?.headers).get("Authorization") === "Bearer fresh" ? 200 : 401,
          },
        ),
    });
    const pending = [
      request("/api/v1/me", { headers: { Authorization: "Bearer old" } }),
      request("/api/v1/customers", { headers: { Authorization: "Bearer old" } }),
    ];
    await Promise.resolve();
    resolve({ accessToken: "fresh", email: "anonymous@example.invalid" });
    const results = await Promise.all(pending);
    expect(
      await Promise.all(
        results.map(async (result) => ({ status: result.status, body: await result.json() })),
      ),
    ).toEqual([
      { status: 200, body: { authorized: true } },
      { status: 200, body: { authorized: true } },
    ]);
    expect({ refreshes, published }).toEqual({
      refreshes: 1,
      published: [{ accessToken: "fresh", email: "anonymous@example.invalid" }],
    });
  });
  it("retries an expired token once with the refreshed memory session and the same write body/key", async () => {
    const requests: {
      authorization: string | null;
      key: string | null;
      body: BodyInit | null | undefined;
    }[] = [];
    const request = createSessionFetch({
      generation: () => 1,
      session: async () => ({ accessToken: "fresh", email: "anonymous@example.invalid" }),
      fetch: async (_url, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          authorization: headers.get("Authorization"),
          key: headers.get("Idempotency-Key"),
          body: init?.body,
        });
        return Response.json(
          { saved: requests.length === 2 },
          { status: requests.length === 1 ? 401 : 200 },
        );
      },
    });
    const response = await request("/api/v1/customers", {
      method: "POST",
      headers: { Authorization: "Bearer old", "Idempotency-Key": "same-operation" },
      body: '{"name":"匿名社"}',
    });
    expect(await response.json()).toEqual({ saved: true });
    expect(requests).toEqual([
      { authorization: "Bearer old", key: "same-operation", body: '{"name":"匿名社"}' },
      { authorization: "Bearer fresh", key: "same-operation", body: '{"name":"匿名社"}' },
    ]);
  });
  it.each([401, 403, 404])(
    "keeps access denied after a %i response, including revoked refreshed sessions",
    async (status) => {
      let calls = 0,
        refreshes = 0;
      const request = createSessionFetch({
        generation: () => 1,
        session: async () => {
          refreshes++;
          return { accessToken: "fresh", email: "anonymous@example.invalid" };
        },
        fetch: async () => {
          calls++;
          return Response.json({ denied: true }, { status });
        },
      });
      const response = await request("/api/v1/me", { headers: { Authorization: "Bearer old" } });
      expect({ status: response.status, body: await response.json(), calls, refreshes }).toEqual({
        status,
        body: { denied: true },
        calls: status === 401 ? 2 : 1,
        refreshes: status === 401 ? 1 : 0,
      });
    },
  );
  it.each([null, { accessToken: "old", email: "anonymous@example.invalid" }])(
    "does not replay an unauthorized request when no new session is available",
    async (session) => {
      let calls = 0;
      const request = createSessionFetch({
        generation: () => 1,
        session: async () => session,
        fetch: async () => {
          calls++;
          return Response.json({ denied: true }, { status: 401 });
        },
      });
      const response = await request("/api/v1/me", { headers: { Authorization: "Bearer old" } });
      expect({ status: response.status, body: await response.json(), calls }).toEqual({
        status: 401,
        body: { denied: true },
        calls: 1,
      });
    },
  );
});
