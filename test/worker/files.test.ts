import { beforeAll, describe, expect, it } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { createBusinessApp } from "../../src/server/businessApp";
import { createApp, type AppDependencies } from "../../src/server/app";
import { fileRoutes } from "../../src/server/modules/evidence/adapter/fileRoutes";
import type { EvidenceStore } from "../../src/server/modules/evidence/domain/files";
import { D1AccessRepository } from "../../src/server/modules/auth/adapter/d1AccessRepository";
import { D1FileRepository } from "../../src/server/modules/evidence/adapter/d1FileRepository";
import { R2EvidenceStore } from "../../src/server/modules/evidence/adapter/r2EvidenceStore";
import { uploadEvidence } from "../../src/server/modules/evidence/usecase/uploadEvidence";
import { inspectEvidence } from "../../src/server/modules/evidence/domain/inspectEvidence";
import { MAX_FILE_BYTES } from "../../src/shared/contracts/files";
import { zipSync, strToU8 } from "fflate";
import { anonymousPdf, anonymousPng, anonymousJpeg } from "../../tests/fixtures/evidenceFiles";
import {
  inspectOfficeZip,
  OFFICE_ZIP_LIMITS,
} from "../../src/server/modules/evidence/domain/inspectOfficeZip";

function office(kind: "docx" | "xlsx", extra: Record<string, Uint8Array> = {}) {
  const main = kind === "docx" ? "word/document.xml" : "xl/workbook.xml",
    type = kind === "docx" ? "wordprocessingml.document" : "spreadsheetml.sheet";
  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`,
    ),
    [main]: strToU8(
      kind === "docx"
        ? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>anonymous</w:t></w:r></w:p></w:body></w:document>'
        : '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
    ),
    ...extra,
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
const text = new TextEncoder().encode("匿名の確認文書\n");
async function sha(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function fixture(store?: EvidenceStore) {
  const actor = crypto.randomUUID(),
    customer = crypto.randomUUID(),
    caseId = crypto.randomUUID(),
    stamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO app_users(id,cognito_sub,email_normalized,role,status,created_at,updated_at) VALUES(?,?,?,'staff','active',?,?)",
    ).bind(actor, actor, `${actor}@example.invalid`, stamp, stamp),
    env.DB.prepare("INSERT INTO customers VALUES(?,?,NULL,1,?,?,?)").bind(
      customer,
      "匿名社",
      actor,
      stamp,
      stamp,
    ),
    env.DB.prepare("INSERT INTO customer_memberships VALUES(?,?,?,?)").bind(
      customer,
      actor,
      actor,
      stamp,
    ),
    env.DB.prepare("INSERT INTO cases VALUES(?,?,?,NULL,1,?,?,?)").bind(
      caseId,
      customer,
      "匿名案件",
      actor,
      stamp,
      stamp,
    ),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const dependencies: AppDependencies = {
    verify: async () => ({
      sub: actor,
      client_id: "fixture",
      token_use: "access",
      iat: now,
      auth_time: now,
      exp: now + 600,
    }),
    access: (b) => new D1AccessRepository(b.DB),
    sessions: () => ({ revoke: async () => {} }),
  };
  const app = store
    ? createApp(dependencies).route(
        "/api/v1",
        fileRoutes(
          (b) => new D1FileRepository(b.DB),
          () => store,
        ),
      )
    : createBusinessApp(dependencies);
  async function upload(
    bytes = text,
    options: { key?: string; name?: string; mime?: string; hash?: string; caseId?: string } = {},
  ) {
    return app.request(
      `/api/v1/cases/${options.caseId ?? caseId}/files`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer fixture",
          "Idempotency-Key": options.key ?? crypto.randomUUID(),
          "X-File-Name": encodeURIComponent(options.name ?? "匿名.txt"),
          "X-Content-SHA256": options.hash ?? (await sha(bytes)),
          "Content-Type": options.mime ?? "text/plain",
        },
        body: bytes,
      },
      env,
    );
  }
  const get = (id: string, content = false) =>
    app.request(
      `/api/v1/files/${id}${content ? "/content" : ""}`,
      { headers: { Authorization: "Bearer fixture" } },
      env,
    );
  return { actor, customer, caseId, app, upload, get };
}
describe("private evidence files", () => {
  it.each(["put", "head", "get"] as const)(
    "returns provider failure for %s exceptions without changing file terminal states or bypassing authorization",
    async (operation) => {
      const real = new R2EvidenceStore(env.EVIDENCE_BUCKET);
      let failing = true,
        failures = 0;
      const injectedFailure = () => {
        if (failing) {
          failures++;
          throw new Error("anonymous provider outage");
        }
      };
      const store: EvidenceStore = {
        put: async (...args) => {
          if (operation === "put") injectedFailure();
          return real.put(...args);
        },
        head: async (...args) => {
          if (operation === "head") injectedFailure();
          return real.head(...args);
        },
        get: async (...args) => {
          if (operation === "get") injectedFailure();
          return real.get(...args);
        },
      };
      const f = await fixture(store),
        key = crypto.randomUUID();
      let response = await f.upload(text, { key });
      const row = await env.DB.prepare(
        "SELECT resource_id AS id FROM operation_receipts WHERE actor_id=? AND operation_key=?",
      )
        .bind(f.actor, key)
        .first<{ id: string }>();
      expect(row).toEqual({ id: expect.any(String) });
      const fileId = row!.id;
      if (operation === "get") {
        expect(response.status).toBe(201);
        response = await f.get(fileId, true);
      }
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: {
          code: "FILE_STORAGE_FAILED",
          message: "ファイルの保存・取得を完了できませんでした。時間を置いてやり直してください。",
        },
        requestId: expect.any(String),
      });
      expect(failures).toBe(1);
      const metadata = (await (await f.get(fileId)).json<{ data: unknown }>()).data;
      expect(metadata).toEqual({
        id: fileId,
        name: "匿名.txt",
        mime: "text/plain",
        sizeBytes: text.length,
        sha256: await sha(text),
        status: operation === "get" ? "ready" : "rejected",
        createdAt: expect.any(String),
      });
      // A same-key replay must neither retry failed storage nor replace a ready object.
      expect((await (await f.upload(text, { key })).json<{ data: unknown }>()).data).toEqual({
        fileId,
        status: operation === "get" ? "ready" : "rejected",
        sizeBytes: text.length,
        sha256: await sha(text),
      });
      expect(failures).toBe(1);
      if (operation !== "get") expect((await f.get(fileId, true)).status).toBe(409);
      await env.DB.prepare("UPDATE app_users SET status='suspended' WHERE id=?")
        .bind(f.actor)
        .run();
      expect((await f.get(fileId, true)).status).toBe(403);
      expect(failures).toBe(1);
      await env.DB.prepare("UPDATE app_users SET status='active' WHERE id=?").bind(f.actor).run();
      failing = false;
      if (operation === "get") {
        const recovered = await f.get(fileId, true);
        expect(recovered.status).toBe(200);
        expect(new Uint8Array(await recovered.arrayBuffer())).toEqual(text);
        expect((await (await f.get(fileId)).json<{ data: unknown }>()).data).toEqual(metadata);
      } else {
        const recovered = await f.upload();
        expect(recovered.status).toBe(201);
        const ready = (
          await recovered.json<{
            data: { fileId: string; status: string; sizeBytes: number; sha256: string };
          }>()
        ).data;
        expect(ready).toEqual({
          fileId: expect.any(String),
          status: "ready",
          sizeBytes: text.length,
          sha256: await sha(text),
        });
        expect(ready.fileId === fileId).toBe(false);
        expect(new Uint8Array(await (await f.get(ready.fileId, true)).arrayBuffer())).toEqual(text);
        expect((await (await f.get(fileId)).json<{ data: unknown }>()).data).toEqual(metadata);
      }
    },
  );
  it("enforces the sum of actual expanded entries and rejects filename aliases used by downstream ZIP readers", () => {
    const normal = office("xlsx"),
      baseline = inspectOfficeZip(normal, "xlsx");
    expect(baseline).toEqual({
      entries: 3,
      fileBytes: normal.length,
      expandedBytes: expect.any(Number),
    });
    const extra = office("xlsx", {
      "a.xml": strToU8("<x>" + "a".repeat(700) + "</x>"),
      "b.xml": strToU8("<x>" + "b".repeat(700) + "</x>"),
    });
    expect(() =>
      inspectOfficeZip(extra, "xlsx", {
        ...OFFICE_ZIP_LIMITS,
        entryBytes: 1024,
        expandedBytes: baseline.expandedBytes + 1000,
      }),
    ).toThrow("ZIP_EXPANDED_SIZE_LIMIT");
    // Same Unicode-path regression as Issue15: an innocuous header must never replace its inspected name.
    for (const effective of [
      "xl/vbaProject.bin",
      "xl/externalLinks/externalLink1.xml",
      "xl/embeddings/oleObject1.bin",
      "xl/worksheets/_rels/sheet1.xml.rels",
    ]) {
      const name = "innocent.bin";
      let crc = 0xffffffff;
      for (const byte of strToU8(name)) {
        crc ^= byte;
        for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }
      const unicode = new Uint8Array(5 + strToU8(effective).length);
      unicode[0] = 1;
      new DataView(unicode.buffer).setUint32(1, (crc ^ 0xffffffff) >>> 0, true);
      unicode.set(strToU8(effective), 5);
      const aliased = zipSync({
        "innocent.bin": [strToU8("anonymous"), { extra: { 0x7075: unicode } }],
      });
      expect(() => inspectOfficeZip(aliased, "xlsx")).toThrow("ZIP_FILENAME_METADATA_UNSUPPORTED");
    }
  });
  it.each(["docx", "xlsx"] as const)(
    "accepts an ordinary %s ZIP package with internal relationships and no active content",
    async (kind) => {
      const f = await fixture(),
        bytes = office(kind),
        mime =
          kind === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const res = await f.upload(bytes, { name: `anonymous.${kind}`, mime });
      expect(res.status).toBe(201);
      const data = (await res.json<{ data: { fileId: string } }>()).data;
      expect(new Uint8Array(await (await f.get(data.fileId, true)).arrayBuffer())).toEqual(bytes);
    },
  );
  it("rejects Office macros, external relations, encryption, malformed ZIP and size violations", async () => {
    const f = await fixture(),
      mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const relation =
      '<Relationships><Relationship TargetMode="Ext&#101;rnal" Target="https://example.invalid"/></Relationships>';
    const utf16 = new Uint8Array(2 + relation.length * 2);
    utf16.set([255, 254]);
    new Uint16Array(utf16.buffer, 2).set(Array.from(relation, (c) => c.charCodeAt(0)));
    const encrypted = office("xlsx");
    new DataView(encrypted.buffer).setUint16(6, 1, true);
    const cases = [
      office("xlsx", { "xl/vbaProject.bin": strToU8("anonymous") }),
      office("xlsx", { "xl/_rels/workbook.xml.rels": strToU8(relation) }),
      office("xlsx", { "xl/_rels/workbook.xml.rels": utf16 }),
      office("docx"),
      encrypted,
      office("xlsx").subarray(0, 30),
      office("xlsx", { "xl/large.xml": new Uint8Array(MAX_FILE_BYTES + 1).fill(65) }),
      office(
        "xlsx",
        Object.fromEntries(
          Array.from({ length: 501 }, (_, i) => [`part${i}.xml`, strToU8("<x/>")]),
        ),
      ),
    ];
    for (const bytes of cases) {
      const res = await f.upload(bytes, { name: "anonymous.xlsx", mime });
      expect(res.status).toBe(422);
      expect((await res.json<{ error: { code: string } }>()).error.code).toBe("FILE_INVALID");
    }
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM files WHERE case_id=? AND status='ready'")
        .bind(f.caseId)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("checks assigned customer on upload/replay/metadata/download and refuses archived cases", async () => {
    const f = await fixture(),
      other = await fixture(),
      key = crypto.randomUUID();
    expect((await f.upload(text, { caseId: other.caseId })).status).toBe(404);
    const data = (await (await f.upload(text, { key })).json<{ data: { fileId: string } }>()).data;
    expect((await other.get(data.fileId)).status).toBe(404);
    await env.DB.prepare("UPDATE cases SET archived_at=? WHERE id=?")
      .bind(new Date().toISOString(), f.caseId)
      .run();
    expect((await f.upload()).status).toBe(409);
    expect((await f.get(data.fileId, true)).status).toBe(200);
    await env.DB.prepare("DELETE FROM customer_memberships WHERE customer_id=? AND user_id=?")
      .bind(f.customer, f.actor)
      .run();
    expect((await f.get(data.fileId)).status).toBe(404);
    expect((await f.get(data.fileId, true)).status).toBe(404);
    expect((await f.upload(text, { key })).status).toBe(404);
  });
  it.each([
    ["anonymous.pdf", "application/pdf", anonymousPdf()],
    ["anonymous.png", "image/png", anonymousPng],
    ["anonymous.jpg", "image/jpeg", anonymousJpeg],
  ])("accepts allowed signature %s and preserves the bytes", async (name, mime, bytes) => {
    const f = await fixture(),
      res = await f.upload(bytes, { name, mime });
    expect(res.status).toBe(201);
    const data = (
      await res.json<{
        data: { fileId: string; status: string; sizeBytes: number; sha256: string };
      }>()
    ).data;
    expect(data).toEqual({
      fileId: expect.any(String),
      status: "ready",
      sizeBytes: bytes.length,
      sha256: await sha(bytes),
    });
    expect(new Uint8Array(await (await f.get(data.fileId, true)).arrayBuffer())).toEqual(bytes);
  });
  it("rejects mismatched content, encrypted PDF, invalid UTF8, forbidden names and SHA mismatch without ready files", async () => {
    const f = await fixture();
    for (const [name, mime, bytes, hash] of [
      ["fake.pdf", "application/pdf", text, undefined],
      [
        "encrypted.pdf",
        "application/pdf",
        new TextEncoder().encode("%PDF-1.7\ntrailer << /Encr#79pt 3 0 R >>\n%%EOF"),
        undefined,
      ],
      ["bad.txt", "text/plain", new Uint8Array([255, 254, 0]), undefined],
      ["bad.txt", "text/plain", new TextEncoder().encode("a\0b"), undefined],
      [
        "fake.txt",
        "text/plain",
        new TextEncoder().encode("<!DOCTYPE html><html>anonymous</html>"),
        undefined,
      ],
      ["bad.svg", "image/svg+xml", text, undefined],
      ["../bad.txt", "text/plain", text, undefined],
      ["valid.txt", "text/plain", text, "0".repeat(64)],
    ] as const) {
      const key = crypto.randomUUID(),
        res = await f.upload(bytes, { key, name, mime, hash });
      expect(res.status).toBe(422);
      expect((await res.json<{ error: { code: string } }>()).error.code).toBe(
        hash ? "FILE_HASH_MISMATCH" : "FILE_INVALID",
      );
      const reserved = await env.DB.prepare(
        "SELECT resource_id AS id FROM operation_receipts WHERE actor_id=? AND operation_key=?",
      )
        .bind(f.actor, key)
        .first<{ id: string }>();
      if (reserved) {
        const stored = await (await f.get(reserved.id)).json<{ data: unknown }>();
        expect(stored.data).toEqual({
          id: reserved.id,
          name,
          mime,
          sizeBytes: bytes.length,
          sha256: hash ?? (await sha(bytes)),
          status: "rejected",
          createdAt: expect.any(String),
        });
        expect((await f.get(reserved.id, true)).status).toBe(409);
      }
    }
    expect(
      await env.DB.prepare("SELECT count(*) AS count FROM files WHERE case_id=? AND status='ready'")
        .bind(f.caseId)
        .first(),
    ).toEqual({ count: 0 });
  });
  it("accepts exactly 10MiB, cancels an oversized stream and records an interrupted upload as rejected", async () => {
    const f = await fixture(),
      bytes = new Uint8Array(MAX_FILE_BYTES).fill(65);
    const accepted = await f.upload(bytes);
    expect(accepted.status).toBe(201);
    expect((await accepted.json<{ data: unknown }>()).data).toEqual({
      fileId: expect.any(String),
      status: "ready",
      sizeBytes: MAX_FILE_BYTES,
      sha256: await sha(bytes),
    });
    for (const interrupted of [false, true]) {
      let pulls = 0,
        cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++;
          if (interrupted) controller.error(new Error("anonymous interruption"));
          else controller.enqueue(bytes);
        },
        cancel() {
          cancelled = true;
        },
      });
      const key = crypto.randomUUID(),
        response = await f.app.request(
          `/api/v1/cases/${f.caseId}/files`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer fixture",
              "Idempotency-Key": key,
              "X-File-Name": "large.txt",
              "Content-Type": "text/plain",
              "X-Content-SHA256": await sha(bytes),
            },
            body,
          },
          env,
        );
      expect(response.status).toBe(interrupted ? 422 : 413);
      expect((await response.json<{ error: { code: string } }>()).error.code).toBe(
        interrupted ? "FILE_UPLOAD_FAILED" : "PAYLOAD_TOO_LARGE",
      );
      expect({ cancelled, pulls }).toEqual({ cancelled: !interrupted, pulls: interrupted ? 1 : 3 });
      const row = await env.DB.prepare(
        "SELECT f.id,f.status FROM files f JOIN operation_receipts r ON r.resource_id=f.id WHERE r.actor_id=? AND r.operation_key=?",
      )
        .bind(f.actor, key)
        .first<{ id: string; status: string }>();
      expect(row).toEqual({ id: expect.any(String), status: "rejected" });
      expect((await f.get(row!.id, true)).status).toBe(409);
    }
  });
  it("does not overwrite an in-flight reservation or partial storage failure on replay", async () => {
    const f = await fixture(),
      repository = new D1FileRepository(env.DB),
      store = new R2EvidenceStore(env.EVIDENCE_BUCKET),
      key = crypto.randomUUID();
    let complete!: () => void, started!: () => void;
    const barrier = new Promise<void>((resolve) => {
        complete = resolve;
      }),
      entered = new Promise<void>((resolve) => {
        started = resolve;
      });
    const input = { name: "pending.txt", mime: "text/plain", sha256: await sha(text) },
      context = {
        actorId: f.actor,
        requestId: crypto.randomUUID(),
        now: () => new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      };
    const waiting = {
      put: async () => {
        started();
        await barrier;
        throw new Error("storage interrupted");
      },
      get: store.get.bind(store),
      head: store.head.bind(store),
    };
    const running = uploadEvidence(
      repository,
      waiting,
      f.caseId,
      input,
      key,
      new Blob([text]).stream(),
      context,
      inspectEvidence,
    );
    const rejected = expect(running).rejects.toMatchObject({ code: "FILE_STORAGE_FAILED" });
    await entered;
    const replay = await f.upload(text, { key, name: "pending.txt" });
    const data = (
      await replay.json<{
        data: { fileId: string; status: string; sha256: string; sizeBytes: number };
      }>()
    ).data;
    expect(data).toEqual({
      fileId: expect.any(String),
      status: "uploading",
      sizeBytes: 0,
      sha256: input.sha256,
    });
    expect((await f.get(data.fileId, true)).status).toBe(409);
    complete();
    await rejected;
    expect(
      (await (await f.upload(text, { key, name: "pending.txt" })).json<{ data: unknown }>()).data,
    ).toEqual({ ...data, status: "rejected", sizeBytes: text.length });
    expect((await f.get(data.fileId, true)).status).toBe(409);
  });
  it("stores verified bytes, replays the reserved file and downloads only with authorization", async () => {
    const f = await fixture(),
      key = crypto.randomUUID(),
      hash = await sha(text);
    const res = await f.upload(text, { key });
    expect(res.status).toBe(201);
    const saved = await res.json<{
      data: { fileId: string; status: string; sha256: string; sizeBytes: number };
    }>();
    expect(saved.data).toEqual({
      fileId: expect.any(String),
      status: "ready",
      sha256: hash,
      sizeBytes: text.length,
    });
    expect((await (await f.upload(text, { key })).json<{ data: unknown }>()).data).toEqual(
      saved.data,
    );
    const meta = await (await f.get(saved.data.fileId)).json<{ data: unknown }>();
    expect(meta.data).toEqual({
      id: saved.data.fileId,
      name: "匿名.txt",
      mime: "text/plain",
      sizeBytes: text.length,
      sha256: hash,
      status: "ready",
      createdAt: expect.any(String),
    });
    const download = await f.get(saved.data.fileId, true);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(text);
    expect([
      download.headers.get("Content-Disposition"),
      download.headers.get("X-Content-Type-Options"),
      download.headers.get("Cache-Control"),
    ]).toEqual([
      `attachment; filename="download.txt"; filename*=UTF-8''${encodeURIComponent("匿名.txt")}`,
      "nosniff",
      "no-store",
    ]);
    const other = await fixture();
    expect((await other.get(saved.data.fileId, true)).status).toBe(404);
    expect((await f.upload(text, { key, name: "別.txt" })).status).toBe(409);
    await env.DB.prepare("UPDATE app_users SET status='suspended' WHERE id=?").bind(f.actor).run();
    expect((await f.get(saved.data.fileId, true)).status).toBe(403);
  });
});
