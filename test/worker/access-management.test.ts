import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function fixture() {
  let clock = Date.parse("2026-09-19T10:00:00.000Z");
  const actor = crypto.randomUUID(),
    staff = crypto.randomUUID(),
    customer = crypto.randomUUID();
  const stamp = new Date(clock).toISOString();
  for (const [id, role] of [
    [actor, "admin"],
    [staff, "staff"],
  ]) {
    await env.DB.prepare(
      "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)",
    )
      .bind(id, id, `${id}@example.invalid`, role, stamp, stamp)
      .run();
  }
  await env.DB.prepare("INSERT INTO customers VALUES(?,?,NULL,1,?,?,?)")
    .bind(customer, "匿名会社", actor, stamp, stamp)
    .run();
  await env.DB.prepare("INSERT INTO customer_memberships VALUES(?,?,?,?)")
    .bind(customer, staff, actor, stamp)
    .run();
  const sent: { userId: string; email: string; sub: string }[] = [];
  const provisioned: string[] = [];
  let fail = false;
  const app = createBusinessApp({
    verify: async (sub) => ({
      sub,
      client_id: "test",
      token_use: "access",
      iat: Math.floor(clock / 1000),
      auth_time: Date.parse("2026-09-19T09:00:00Z") / 1000,
      exp: Math.floor(clock / 1000) + 600,
    }),
    access: (b) => new D1AccessRepository(b.DB, () => clock),
    sessions: () => ({ revoke: async () => {} }),
    administration: () => ({
      provision: async (user: { id: string; email: string }) => {
        provisioned.push(user.id);
        return `reserved-${user.id}`;
      },
      sendInvitation: async (user: { id: string; email: string; sub: string }) => {
        sent.push({ userId: user.id, email: user.email, sub: user.sub });
        if (fail) throw new Error("provider delivery failed");
      },
    }),
    now: () => clock,
  });
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    key = crypto.randomUUID(),
    token = actor,
  ) {
    const response = await app.request(
      `/api/v1${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    return {
      status: response.status,
      body: await response.json<{ data: any; error?: { code: string } }>(),
    };
  }
  const invite = (email = `${crypto.randomUUID()}@example.invalid`, key = crypto.randomUUID()) =>
    request("/users/invitations", "POST", { email, role: "staff", customerIds: [customer] }, key);
  return {
    actor,
    staff,
    customer,
    request,
    invite,
    sent,
    provisioned,
    setFailure: (value: boolean) => {
      fail = value;
    },
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}

describe("access management through the product API and real D1", () => {
  it("recovers a reservation interrupted before claim through an explicit retry without requiring the original key", async () => {
    const f = await fixture(),
      id = crypto.randomUUID(),
      userId = crypto.randomUUID(),
      email = `${userId}@example.invalid`;
    await env.DB.prepare(
      "INSERT INTO app_users(id,email_normalized,role,status,created_at,updated_at) VALUES(?,?,'staff','invited','2026-09-19T10:00:00.000Z','2026-09-19T10:00:00.000Z')",
    )
      .bind(userId, email)
      .run();
    await env.DB.prepare(
      "INSERT INTO invitations(id,user_id,status,expires_at,created_by,created_at) VALUES(?,?,'pending','2026-09-26T10:00:00.000Z',?,'2026-09-19T10:00:00.000Z')",
    )
      .bind(id, userId, f.actor)
      .run();
    const list = await f.request("/users/invitations");
    expect(
      list.body.data.items.find((item: { invitationId: string }) => item.invitationId === id),
    ).toEqual({
      invitationId: id,
      userId,
      email,
      role: "staff",
      userStatus: "invited",
      status: "pending",
      expiresAt: "2026-09-26T10:00:00.000Z",
      lastErrorCode: null,
      retryAllowed: true,
    });
    const retryKey = crypto.randomUUID();
    const result = await f.request(`/users/invitations/${id}/retry`, "POST", {}, retryKey);
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({
      invitationId: id,
      status: "sent",
      expiresAt: "2026-09-26T10:00:00.000Z",
    });
    expect(
      (await f.request(`/users/invitations/${id}/retry`, "POST", {}, retryKey)).body.data,
    ).toEqual(result.body.data);
    expect(f.sent).toEqual([{ userId, email, sub: `reserved-${userId}` }]);
    expect(f.provisioned).toEqual([userId]);
  });
  it("can stop an unused invitation and returns it to invited on recovery without bypassing first login", async () => {
    const f = await fixture();
    await f.invite();
    const delivery = f.sent[0],
      userId = delivery.userId;
    const stop = await f.request(`/users/${userId}`, "PATCH", {
      expectedRevision: 2,
      mutationId: crypto.randomUUID(),
      role: "staff",
      status: "suspended",
    });
    expect(stop.status).toBe(200);
    expect(stop.body.data.status).toBe("suspended");
    const restored = await f.request(`/users/${userId}`, "PATCH", {
      expectedRevision: 3,
      mutationId: crypto.randomUUID(),
      role: "staff",
      status: "active",
    });
    expect(restored.status).toBe(200);
    expect(restored.body.data.status).toBe("invited");
    expect(
      (await f.request("/me", "GET", undefined, crypto.randomUUID(), delivery.sub)).status,
    ).toBe(401);
    expect(f.sent).toEqual([delivery]);
  });
  it("shares the global operation key ledger across invitation retries and other writes", async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    f.setFailure(true);
    const created = await f.invite(undefined, key);
    expect(created.status).toBe(502);
    const invitation = await env.DB.prepare("SELECT id FROM invitations WHERE created_by=?")
      .bind(f.actor)
      .first<{ id: string }>();
    f.setFailure(false);
    const retry = await f.request(`/users/invitations/${invitation!.id}/retry`, "POST", {}, key);
    expect(retry.status).toBe(409);
    expect(retry.body.error?.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(f.sent).toHaveLength(1);
    const retryKey = crypto.randomUUID();
    expect(
      (await f.request(`/users/invitations/${invitation!.id}/retry`, "POST", {}, retryKey)).status,
    ).toBe(200);
    expect((await f.request("/customers", "POST", { name: "別操作" }, retryKey)).status).toBe(409);
  });
  it("claims simultaneous explicit retries once and leaves a second attempt unsent", async () => {
    const f = await fixture();
    f.setFailure(true);
    await f.invite();
    const invitation = await env.DB.prepare("SELECT id FROM invitations WHERE created_by=?")
      .bind(f.actor)
      .first<{ id: string }>();
    f.setFailure(false);
    const results = await Promise.all([
      f.request(`/users/invitations/${invitation!.id}/retry`, "POST", {}),
      f.request(`/users/invitations/${invitation!.id}/retry`, "POST", {}),
    ]);
    expect(results.map((result) => result.status).sort((left, right) => left - right)).toEqual([
      200, 409,
    ]);
    expect(f.sent).toEqual([f.sent[0], f.sent[0]]);
    expect(f.provisioned).toHaveLength(1);
  });
  it("requires a five-minute processing lease to expire before recovering an interrupted send", async () => {
    const f = await fixture(),
      created = await f.invite(),
      id = created.body.data.invitationId;
    await env.DB.prepare(
      "UPDATE invitations SET status='processing',processing_started_at='2026-09-19T10:00:00.000Z' WHERE id=?",
    )
      .bind(id)
      .run();
    expect((await f.request(`/users/invitations/${id}/retry`, "POST", {})).status).toBe(409);
    f.advance(299999);
    expect((await f.request(`/users/invitations/${id}/retry`, "POST", {})).status).toBe(409);
    f.advance(1);
    expect((await f.request(`/users/invitations/${id}/retry`, "POST", {})).status).toBe(200);
    expect(f.sent).toEqual([f.sent[0], f.sent[0]]);
  });
  it("rejects initial activation exactly at the seven-day expiry boundary", async () => {
    const f = await fixture(),
      created = await f.invite(),
      sub = f.sent[0].sub;
    f.advance(7 * 86400000);
    const result = await f.request("/me", "GET", undefined, crypto.randomUUID(), sub);
    expect(result.status).toBe(403);
    expect(result.body.error?.code).toBe("ACCOUNT_DISABLED");
    expect(
      (await f.request(`/users/invitations/${created.body.data.invitationId}/retry`, "POST", {}))
        .status,
    ).toBe(200);
    expect((await f.request("/me", "GET", undefined, crypto.randomUUID(), sub)).status).toBe(200);
  });
  it("issues one normalized invitation and reserves the same subject before sending, including on replay", async () => {
    const f = await fixture(),
      key = crypto.randomUUID(),
      email = `${crypto.randomUUID()}@example.invalid`;
    const first = await f.invite(`  ${email.toUpperCase()}  `, key);
    expect(first.status).toBe(201);
    expect(first.body.data).toEqual({
      invitationId: expect.any(String),
      status: "sent",
      expiresAt: "2026-09-26T10:00:00.000Z",
    });
    expect((await f.invite(email, key)).body.data).toEqual(first.body.data);
    const user = await env.DB.prepare(
      "SELECT id,cognito_sub AS sub,status FROM app_users WHERE email_normalized=?",
    )
      .bind(email)
      .first<{ id: string; sub: string; status: string }>();
    expect(user).toEqual({
      id: expect.any(String),
      sub: `reserved-${user!.id}`,
      status: "invited",
    });
    expect(f.sent).toEqual([{ userId: user!.id, email, sub: user!.sub }]);
    expect(f.provisioned).toEqual([user!.id]);
    expect((await f.invite(email)).body.error?.code).toBe("INVITATION_EXISTS");
  });
  it("keeps a failed invitation and subject without automatic resend, then explicitly retries once", async () => {
    const f = await fixture(),
      key = crypto.randomUUID(),
      email = `${crypto.randomUUID()}@example.invalid`;
    f.setFailure(true);
    const failed = await f.invite(email, key);
    expect(failed.status).toBe(502);
    expect(failed.body.error?.code).toBe("PROVIDER_FAILED");
    expect((await f.invite(email, key)).status).toBe(502);
    expect(f.sent).toHaveLength(1);
    const row = await env.DB.prepare(
      "SELECT i.id,u.id AS userId,u.cognito_sub AS sub,i.status FROM invitations i JOIN app_users u ON u.id=i.user_id WHERE email_normalized=?",
    )
      .bind(email)
      .first<{ id: string; userId: string; sub: string; status: string }>();
    expect(row).toEqual({
      id: expect.any(String),
      userId: expect.any(String),
      sub: `reserved-${row!.userId}`,
      status: "failed",
    });
    f.setFailure(false);
    const retryKey = crypto.randomUUID(),
      url = `/users/invitations/${row!.id}/retry`;
    const retry = await f.request(url, "POST", {}, retryKey);
    expect(retry.status).toBe(200);
    expect((await f.request(url, "POST", {}, retryKey)).body.data).toEqual(retry.body.data);
    expect(f.sent).toEqual([
      { userId: row!.userId, email, sub: row!.sub },
      { userId: row!.userId, email, sub: row!.sub },
    ]);
    expect(f.provisioned).toEqual([row!.userId]);
  });
  it("shows an expired invitation and permits explicit reissue to the same subject", async () => {
    const f = await fixture(),
      created = await f.invite();
    f.advance(7 * 86400000);
    const list = await f.request("/users/invitations");
    expect(
      list.body.data.items.find(
        (item: { invitationId: string }) => item.invitationId === created.body.data.invitationId,
      ).status,
    ).toBe("expired");
    const retry = await f.request(
      `/users/invitations/${created.body.data.invitationId}/retry`,
      "POST",
      {},
    );
    expect(retry.body.data).toEqual({
      ...created.body.data,
      expiresAt: "2026-10-03T10:00:00.000Z",
    });
    expect(f.sent).toEqual([f.sent[0], f.sent[0]]);
    expect(f.provisioned).toHaveLength(1);
  });
  it("replays a failed retry without sending, then recovers with a new explicit attempt key and the same subject", async () => {
    const f = await fixture();
    f.setFailure(true);
    expect((await f.invite()).status).toBe(502);
    const invitation = await env.DB.prepare("SELECT id FROM invitations WHERE created_by=?")
      .bind(f.actor)
      .first<{ id: string }>();
    const path = `/users/invitations/${invitation!.id}/retry`,
      failedKey = crypto.randomUUID();
    expect((await f.request(path, "POST", {}, failedKey)).status).toBe(502);
    expect(f.sent).toHaveLength(2);
    f.setFailure(false);
    const replay = await f.request(path, "POST", {}, failedKey);
    expect(replay.status).toBe(502);
    expect(replay.body.error?.code).toBe("PROVIDER_FAILED");
    expect(f.sent).toHaveLength(2);
    const recoveredKey = crypto.randomUUID(),
      recovered = await f.request(path, "POST", {}, recoveredKey);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.status).toBe("sent");
    expect((await f.request(path, "POST", {}, recoveredKey)).body.data).toEqual(
      recovered.body.data,
    );
    expect(f.sent).toEqual([f.sent[0], f.sent[0], f.sent[0]]);
    expect(f.provisioned).toEqual([f.sent[0].userId]);
  });
  it("refuses staff management and invalid customer/user IDs without provider calls", async () => {
    const f = await fixture();
    for (const [path, method, body] of [
      ["/users", "GET", undefined],
      ["/users/invitations", "GET", undefined],
      [
        "/users/invitations",
        "POST",
        { email: "person@example.invalid", role: "staff", customerIds: [] },
      ],
      [
        `/users/${f.actor}`,
        "PATCH",
        { expectedRevision: 1, mutationId: crypto.randomUUID(), role: "staff", status: "active" },
      ],
      [
        `/customers/${f.customer}/members`,
        "PUT",
        { expectedRevision: 1, mutationId: crypto.randomUUID(), userIds: [] },
      ],
    ] as const) {
      expect((await f.request(path, method, body, crypto.randomUUID(), f.staff)).status).toBe(403);
    }
    expect(
      (
        await f.request("/users/invitations", "POST", {
          email: "person@example.invalid",
          role: "staff",
          customerIds: [crypto.randomUUID()],
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await f.request(`/customers/${f.customer}/members`, "PUT", {
          expectedRevision: 1,
          mutationId: crypto.randomUUID(),
          userIds: [crypto.randomUUID()],
        })
      ).status,
    ).toBe(422);
    expect(f.sent).toEqual([]);
  });
  it("replaces membership with customer CAS and rejects an existing token immediately", async () => {
    const f = await fixture();
    expect(
      (await f.request(`/customers/${f.customer}`, "GET", undefined, crypto.randomUUID(), f.staff))
        .status,
    ).toBe(200);
    const body = { expectedRevision: 1, mutationId: crypto.randomUUID(), userIds: [] };
    const changed = await f.request(`/customers/${f.customer}/members`, "PUT", body);
    expect(changed.body.data).toEqual({ customerId: f.customer, revision: 2, userIds: [] });
    expect((await f.request(`/customers/${f.customer}/members`, "PUT", body)).body.data).toEqual(
      changed.body.data,
    );
    expect(
      (await f.request(`/customers/${f.customer}`, "GET", undefined, crypto.randomUUID(), f.staff))
        .status,
    ).toBe(404);
    expect(
      (
        await f.request(`/customers/${f.customer}/members`, "PUT", {
          ...body,
          mutationId: crypto.randomUUID(),
          userIds: [f.staff],
        })
      ).status,
    ).toBe(409);
    expect(f.sent).toEqual([]);
  });
  it("suspends immediately, preserves the clock-tolerant cutoff on recovery and never sends a contact email", async () => {
    const f = await fixture();
    const update = await f.request(`/users/${f.staff}`, "PATCH", {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      role: "staff",
      status: "suspended",
    });
    expect(update.body.data).toEqual({
      id: f.staff,
      email: `${f.staff}@example.invalid`,
      role: "staff",
      status: "suspended",
      revision: 2,
      customerIds: [f.customer],
    });
    expect(
      (await f.request("/customers", "GET", undefined, crypto.randomUUID(), f.staff)).status,
    ).toBe(403);
    expect(
      (
        await f.request(`/users/${f.staff}`, "PATCH", {
          expectedRevision: 2,
          mutationId: crypto.randomUUID(),
          role: "staff",
          status: "active",
        })
      ).status,
    ).toBe(200);
    expect(
      (await f.request("/customers", "GET", undefined, crypto.randomUUID(), f.staff)).status,
    ).toBe(401);
    expect(
      await env.DB.prepare("SELECT revoked_before AS cutoff FROM app_users WHERE id=?")
        .bind(f.staff)
        .first(),
    ).toEqual({ cutoff: Date.parse("2026-09-19T10:00:05Z") / 1000 });
    expect(f.sent).toEqual([]);
  });
  it("protects the last active admin and leaves its revision unchanged", async () => {
    const f = await fixture();
    // Keep only this fixture's administrator active; every test creates independent identities.
    await env.DB.prepare("UPDATE app_users SET status='suspended' WHERE role='admin' AND id<>?")
      .bind(f.actor)
      .run();
    const result = await f.request(`/users/${f.actor}`, "PATCH", {
      expectedRevision: 1,
      mutationId: crypto.randomUUID(),
      role: "staff",
      status: "active",
    });
    expect(result.status).toBe(409);
    expect(result.body.error?.code).toBe("LAST_ADMIN");
    expect(
      await env.DB.prepare("SELECT role,status,revision FROM app_users WHERE id=?")
        .bind(f.actor)
        .first(),
    ).toEqual({ role: "admin", status: "active", revision: 1 });
  });
});
