import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { readCloudInput, liveOrigin } from "../../scripts/cloud-config.mjs";
import { cloudIo, requireResponse } from "../../scripts/cloud-io.mjs";
import { openAiProvider } from "../../src/server/modules/advice/adapter/aiProvider";
import { D1AiBudget } from "../../src/server/modules/advice/adapter/d1AiBudget";
import { hashAiInput, aiDraftSchema } from "../../src/shared/contracts/aiAdvice";
import { validateManifest, hashBytes, hashRows } from "../../scripts/recovery.mjs";
import { z } from "zod";
import { livePreflight, withLivePreflight } from "../../scripts/live-preflight.mjs";
import { deployedAiAcceptance } from "./deployedAi";
import { recoveryEvidenceSchema, restoredEvidenceAcceptance } from "./restoredEvidence";

// This suite deliberately fails without operator-provided, dedicated real resources.
// No local server, fake HTTP response, skipped acceptance or credential-file lookup.
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Required live input missing: ${name}`);
  return value;
};
let config: ReturnType<typeof readCloudInput>,
  io: ReturnType<typeof cloudIo>,
  base: string,
  tokens: string[],
  users: { id: string; role: string }[];
let customerId: string, caseId: string, assessmentId: string;
const measurements: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  kind: "real-cloud",
};
function record(name: string, value: unknown) {
  measurements[name] = value;
  mkdirSync(".local/live", { recursive: true });
  writeFileSync(".local/live/cloud-results.json", JSON.stringify(measurements, null, 2) + "\n");
}
async function api(
  path: string,
  body?: unknown,
  token = tokens[0],
  method = body === undefined ? "GET" : "POST",
) {
  return fetch(`${base}/api/v1${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function data(response: Response, expected = 200) {
  expect(response.status).toBe(expected);
  return z.object({ data: z.any() }).parse(await response.json()).data;
}
beforeAll(async () => {
  config = readCloudInput(required("SCS_CLOUD_INPUT"), process.cwd());
  io = cloudIo(config, process.env);
  base = liveOrigin(config, required("SCS_LIVE_BASE_URL"));
  tokens = JSON.parse(required("SCS_LIVE_TOKENS_JSON"));
  if (
    !Array.isArray(tokens) ||
    tokens.length !== 5 ||
    tokens.some((token) => typeof token !== "string" || token.split(".").length !== 3)
  )
    throw new Error("Five real operator-authorized sessions are required.");
  required("SCS_LIVE_OTHER_TOKEN");
  required("SCS_OPENAI_API_KEY");
  if (
    required("SCS_OPENAI_DATA_CONFIRMED") !== "true" ||
    required("SCS_COST_ESTIMATE_CONFIRMED") !== config.workerName
  )
    throw new Error("Confirm data settings and the <= USD10 non-AI estimate before running.");
  await withLivePreflight(config, io, base, async (observed) => {
    record("inventory", observed);
    users = await Promise.all(
      tokens.map((token) => api("/me", undefined, token).then((response) => data(response))),
    );
    if (users[0].role !== "admin" || new Set(users.map((user) => user.id)).size !== 5)
      throw new Error("Five distinct users including an administrator are required.");
  });
});

describe.sequential("selected real cloud acceptance", () => {
  it("creates at most 50 anonymous customers and 500 diagnoses, then observes one winner among five concurrent CAS edits", async () => {
    const existing = (
      await io.query(
        "SELECT (SELECT count(*) FROM assessments) AS assessments,(SELECT count(*) FROM customers) AS customers",
      )
    )[0].results[0];
    if (existing.assessments > 500 || existing.customers > 50)
      throw new Error("Approved scale exceeded; do not add or overwrite data.");
    expect(
      (
        await io.query(
          "SELECT count(*) AS count FROM customers WHERE name NOT GLOB '匿名検証[0-9]*'",
        )
      )[0].results,
    ).toEqual([{ count: 0 }]);
    const started = Date.now(),
      latencies: number[] = [];
    for (let company = 0; company < 50; company++) {
      const previous = (
        await io.query("SELECT id FROM customers WHERE name=?", [`匿名検証${company + 1}`])
      )[0].results;
      if (previous.length > 1) throw new Error("Ambiguous trial customer.");
      const customer =
        previous[0] ??
        (await data(await api("/customers", { name: `匿名検証${company + 1}` }), 201));
      if (company === 0) {
        customerId = customer.id;
        const members = await data(await api(`/customers/${customer.id}/members`));
        await data(
          await api(
            `/customers/${customer.id}/members`,
            {
              expectedRevision: members.revision,
              mutationId: randomUUID(),
              userIds: users.map((user) => user.id),
            },
            tokens[0],
            "PUT",
          ),
        );
      }
      for (let diagnosis = 0; diagnosis < 10; diagnosis++) {
        const start = Date.now();
        const rows = (
          await io.query(
            "SELECT c.id AS caseId,a.id AS assessmentId FROM cases c JOIN assessments a ON a.case_id=c.id WHERE c.customer_id=? AND c.name=?",
            [customer.id, `匿名診断${diagnosis + 1}`],
          )
        )[0].results;
        if (rows.length > 1) throw new Error("Ambiguous trial diagnosis.");
        const created = rows.length
          ? { case: { id: rows[0].caseId }, assessmentId: rows[0].assessmentId }
          : await data(
              await api(`/customers/${customer.id}/cases`, {
                name: `匿名診断${diagnosis + 1}`,
                standardId: "scs-20260327-star3",
                diagnosisDate: "2026-09-25",
                scope: { companies: "匿名", sites: "匿名", departments: "匿名", systems: "匿名" },
              }),
              201,
            );
        latencies.push(Date.now() - start);
        if (company === 0 && diagnosis === 0) {
          caseId = created.case.id;
          assessmentId = created.assessmentId;
        }
      }
    }
    const first = await data(await api(`/assessments/${assessmentId}`));
    const responses = await Promise.all(
      tokens.map((token, index) =>
        api(
          `/assessments/${assessmentId}/scope`,
          {
            expectedRevision: first.revision,
            mutationId: randomUUID(),
            diagnosisDate: "2026-09-25",
            scope: {
              companies: `匿名${index}`,
              sites: "匿名",
              departments: "匿名",
              systems: "匿名",
            },
          },
          token,
          "PATCH",
        ),
      ),
    );
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([
      200, 409, 409, 409, 409,
    ]);
    const after = await data(await api(`/assessments/${assessmentId}`));
    expect(after.revision).toBe(first.revision + 1);
    expect((await io.query("SELECT count(*) AS count FROM assessments"))[0].results).toEqual([
      { count: 500 },
    ]);
    const info = await io.cf(`d1/database/${config.databaseId}`);
    expect(info.file_size).toBeLessThanOrEqual(1000000000);
    latencies.sort((a, b) => a - b);
    record("scale", {
      customers: 50,
      assessments: 500,
      concurrentDistinctUsers: 5,
      elapsedMs: Date.now() - started,
      p95CreateMs: latencies[Math.floor(latencies.length * 0.95)],
      databaseBytes: info.file_size,
    });
    record("identifiers", { customerId, caseId, assessmentId });
  });
  it("rolls back a failed remote D1 batch without leaving its earlier write", async () => {
    const id = randomUUID();
    await io.query(
      "CREATE TABLE IF NOT EXISTS live_rollback_probe(id TEXT PRIMARY KEY,value INTEGER CHECK(value>0))",
    );
    await expect(
      io.query(
        `INSERT INTO live_rollback_probe VALUES('${id}',1); INSERT INTO live_rollback_probe VALUES('${id}-invalid',-1)`,
      ),
    ).rejects.toThrow();
    expect(
      (await io.query("SELECT * FROM live_rollback_probe WHERE id=?", [id]))[0].results,
    ).toEqual([]);
    await io.query(
      `INSERT INTO live_rollback_probe VALUES('${id}',1); INSERT INTO live_rollback_probe VALUES('${id}-valid',2)`,
    );
    expect(
      (await io.query("SELECT * FROM live_rollback_probe WHERE id=?", [id]))[0].results,
    ).toEqual([{ id, value: 1 }]);
    expect(
      (await io.query("SELECT * FROM live_rollback_probe WHERE id=?", [`${id}-valid`]))[0].results,
    ).toEqual([{ id: `${id}-valid`, value: 2 }]);
    record("rollback", { passed: true });
  });
  it("holds actual R2 content until GuardDuty is clean, rejects another customer and blocks EICAR", async () => {
    const upload = async (bytes: Buffer) => {
      const response = await fetch(`${base}/api/v1/cases/${caseId}/files`, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${tokens[0]}`,
          "Idempotency-Key": randomUUID(),
          "X-File-Name": "anonymous.txt",
          "Content-Type": "text/plain",
          "X-Content-SHA256": createHash("sha256").update(bytes).digest("hex"),
        },
        body: new Uint8Array(bytes),
      });
      return data(response, 201);
    };
    const bytes = Buffer.from("anonymous verification file"),
      clean = await upload(bytes),
      start = Date.now();
    expect(clean.status).toBe("uploading");
    expect(
      (await api(`/files/${clean.fileId}/content`, undefined, required("SCS_LIVE_OTHER_TOKEN")))
        .status,
    ).toBe(404);
    await expect
      .poll(async () => (await data(await api(`/files/${clean.fileId}`))).status, {
        timeout: 300000,
        interval: 3000,
      })
      .toBe("ready");
    const download = await api(`/files/${clean.fileId}/content`);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    const scanned = (
      await io.query("SELECT scan_key,scan_version FROM file_scans WHERE file_id=?", [clean.fileId])
    )[0].results[0];
    const forged = await io.aws(
      "s3",
      `/${scanned.scan_key}?tagging=&versionId=${encodeURIComponent(scanned.scan_version)}`,
      {
        method: "PUT",
        headers: {
          "x-amz-expected-bucket-owner": config.awsAccountId,
          "Content-Type": "application/xml",
        },
        body: "<Tagging><TagSet><Tag><Key>GuardDutyMalwareScanStatus</Key><Value>NO_THREATS_FOUND</Value></Tag></TagSet></Tagging>",
      },
    );
    expect(forged.status).toBe(403);
    await forged.body?.cancel();
    expect((await api("/scan/results", { fileId: clean.fileId, status: "clean" })).status).toBe(
      404,
    );
    const eicar = Buffer.from(
      ["X5O!P%@AP[4\\PZX54(P^)7CC)7}", "$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""),
    );
    const rejected = await upload(eicar);
    await expect
      .poll(async () => (await data(await api(`/files/${rejected.fileId}`))).status, {
        timeout: 300000,
        interval: 3000,
      })
      .toBe("rejected");
    expect((await api(`/files/${rejected.fileId}/content`)).status).toBe(409);
    expect({ sha256: clean.sha256, sizeBytes: clean.sizeBytes }).toEqual({
      sha256: hashBytes(bytes),
      sizeBytes: bytes.length,
    });
    expect({ sha256: rejected.sha256, sizeBytes: rejected.sizeBytes }).toEqual({
      sha256: hashBytes(eicar),
      sizeBytes: eicar.length,
    });
    const recoveryEvidence = recoveryEvidenceSchema.parse({
      schemaVersion: 1,
      sourceWorker: config.workerName,
      sourceDatabase: config.databaseId,
      clean: { fileId: clean.fileId, sha256: clean.sha256, sizeBytes: clean.sizeBytes },
      blocked: { fileId: rejected.fileId, sha256: rejected.sha256, sizeBytes: rejected.sizeBytes },
    });
    mkdirSync(".local/live/recovery-evidence", { recursive: true });
    const recoveryEvidencePath = resolve(".local/live/recovery-evidence", `${clean.fileId}.json`);
    writeFileSync(recoveryEvidencePath, JSON.stringify(recoveryEvidence, null, 2) + "\n", {
      flag: "wx",
    });
    record("scan", {
      cleanFileId: clean.fileId,
      blockedFileId: rejected.fileId,
      recoveryEvidencePath,
      elapsedMs: Date.now() - start,
      files: 2,
      forgedVerdictDenied: true,
      bytes: bytes.length + eicar.length,
    });
  });
  it("sends the exact five anonymous keys through the real OpenAI adapter and persistent trial budget", async () => {
    if (config.openAiMode !== "trial")
      throw new Error("Deploy the dedicated Worker with trial AI enabled before AI acceptance.");
    const recordBefore = await data(await api(`/assessments/${assessmentId}`));
    const standard = await data(await api("/standards/scs-20260327-star3")),
      criterion = standard.criteria[0];
    const input = {
      standardId: "scs-20260327-star3",
      criterionId: criterion.id,
      officialRequirement: criterion.officialText,
      anonymousAnswer: "担当と実施記録の整備が途中です。",
      anonymousGap: "担当を定め、定期点検の記録を残す必要があります。",
    };
    const hash = await hashAiInput(input),
      runId = randomUUID(),
      stamp = new Date().toISOString();
    await io.query(
      "INSERT INTO ai_runs(id,assessment_id,criterion_id,input_hash,basis_hash,status,requested_by,created_at) VALUES(?,?,?,?,?,'running',?,?)",
      [
        runId,
        assessmentId,
        criterion.id,
        hash,
        recordBefore.document.responses[criterion.id].basisHash,
        users[0].id,
        stamp,
      ],
    );
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          first: async () => (await io.query(sql, params))[0].results[0] ?? null,
        }),
      }),
    } as unknown as ConstructorParameters<typeof D1AiBudget>[0];
    let calls = 0,
      requestId: string | null = null;
    const transport: typeof fetch = async (url, init) => {
      if (url !== "https://api.openai.com/v1/responses")
        throw new Error("Unexpected OpenAI origin.");
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
      const request = JSON.parse(init.body);
      const actual = JSON.parse(request.input[0].content);
      expect(actual).toEqual(input);
      expect(Object.keys(actual).sort()).toEqual([
        "anonymousAnswer",
        "anonymousGap",
        "criterionId",
        "officialRequirement",
        "standardId",
      ]);
      calls++;
      const response = await fetch(url, init);
      requestId = response.headers.get("x-request-id");
      return response;
    };
    const provider = openAiProvider(
      {
        OPENAI_API_KEY: required("SCS_OPENAI_API_KEY"),
        OPENAI_MODEL: "gpt-6-sol",
        OPENAI_MODE: "trial",
      },
      new D1AiBudget(db, Date.now),
      transport,
    );
    try {
      const draft = aiDraftSchema.parse(
        await provider.generate(input, AbortSignal.timeout(30000), runId),
      );
      expect(draft.origin).toBe("ai");
      expect(draft.steps.length).toBeGreaterThan(0);
      expect(calls).toBe(1);
      await io.query(
        "UPDATE ai_runs SET status='succeeded',provider_model='gpt-6-sol' WHERE id=?",
        [runId],
      );
      record("openaiTransport", {
        runId,
        requestId,
        inputHash: hash,
        keys: Object.keys(input).sort(),
        calls,
        reservedCents: 10,
      });
    } catch (error) {
      await io.query(
        "UPDATE ai_runs SET status='failed',error_code='LIVE_VERIFICATION_FAILED' WHERE id=?",
        [runId],
      );
      throw error;
    }
    record(
      "openaiProduct",
      await deployedAiAcceptance(
        assessmentId,
        input,
        (path, body) => api(path, body),
        (sql, params) => io.query(sql, params),
      ),
    );
  });
  it("reads restored D1 and R2 contents and measures recovery age and duration", async () => {
    const manifest = validateManifest(
      JSON.parse(readFileSync(resolve(required("SCS_BACKUP_MANIFEST")), "utf8")),
      config.workerName,
      config.restoreDatabaseId,
      config.databaseId,
    );
    const restore = JSON.parse(readFileSync(resolve(required("SCS_RESTORE_MEASUREMENT")), "utf8"));
    expect(restore.databaseId).toBe(config.restoreDatabaseId);
    expect(hashBytes(readFileSync(restore.sqlFile))).toBe(restore.restoreSqlSha256);
    expect(restore.tableChecksums.length).toBeGreaterThan(10);
    for (const table of restore.tableChecksums) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table.name))
        throw new Error("Unexpected restore table.");
      const actual: Record<string, unknown>[] = [];
      for (let offset = 0; offset <= table.rows; offset += 500)
        actual.push(
          ...(
            await io.query(
              `SELECT * FROM "${table.name}" LIMIT 500 OFFSET ?`,
              [offset],
              config.restoreDatabaseId,
            )
          )[0].results,
        );
      expect({ rows: actual.length, sha256: hashRows(actual) }).toEqual({
        rows: table.rows,
        sha256: table.sha256,
      });
    }
    expect(
      (await io.query("SELECT count(*) AS count FROM assessments", [], config.restoreDatabaseId))[0]
        .results,
    ).toEqual([{ count: 500 }]);
    expect(
      (await io.query("PRAGMA foreign_key_check", [], config.restoreDatabaseId))[0].results,
    ).toEqual([]);
    expect(
      (
        await io.query(
          "SELECT count(*) AS count FROM file_scans WHERE status='clean'",
          [],
          config.restoreDatabaseId,
        )
      )[0].results,
    ).toEqual([{ count: 0 }]);
    for (const file of manifest.files) {
      const response = await requireResponse(await io.r2("restore", file.objectKey));
      const bytes = Buffer.from(await response.arrayBuffer());
      expect({ bytes: bytes.length, sha256: hashBytes(bytes) }).toEqual({
        bytes: file.sizeBytes,
        sha256: file.sha256,
      });
    }
    const restoredOrigin = liveOrigin(config, required("SCS_LIVE_RESTORE_BASE_URL"), true);
    await livePreflight(config, io, restoredOrigin, true);
    const restoredToken = required("SCS_LIVE_RESTORED_TOKEN");
    const settings = await io.cf(`workers/scripts/${config.workerName}-restore/settings`);
    expect(settings.bindings.find((b: { name: string }) => b.name === "DB").id).toBe(
      config.restoreDatabaseId,
    );
    expect(
      settings.bindings.find((b: { name: string }) => b.name === "EVIDENCE_BUCKET").bucket_name,
    ).toBe(`${config.workerName}-restore`);
    const recoveredApi = (
      path: string,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) =>
      fetch(`${restoredOrigin}/api/v1${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(60000),
        headers: {
          Authorization: `Bearer ${restoredToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect((await data(await recoveredApi("/me"))).role).toBe("admin");
    const recovered = await data(await recoveredApi(`/assessments/${assessmentId}`));
    const changed = await data(
      await recoveredApi(
        `/assessments/${assessmentId}/scope`,
        {
          expectedRevision: recovered.revision,
          mutationId: randomUUID(),
          diagnosisDate: recovered.document.diagnosisDate,
          scope: { ...recovered.document.scope, sites: "復旧後の匿名更新" },
        },
        "PATCH",
      ),
    );
    expect(changed.revision).toBe(recovered.revision + 1);
    const restoredEvidence = await restoredEvidenceAcceptance(
      manifest,
      JSON.parse(readFileSync(resolve(required("SCS_RECOVERY_EVIDENCE")), "utf8")),
      recoveredApi,
      async (readStatus) => {
        await expect.poll(readStatus, { timeout: 300000, interval: 3000 }).toBe("ready");
      },
    );
    const rpoHours = (Date.parse(restore.startedAt) - Date.parse(manifest.createdAt)) / 3600000;
    const rtoHours = (Date.now() - Date.parse(restore.startedAt)) / 3600000;
    expect(rpoHours).toBeGreaterThanOrEqual(0);
    expect(rpoHours).toBeLessThanOrEqual(24);
    expect(rtoHours).toBeGreaterThanOrEqual(0);
    expect(rtoHours).toBeLessThanOrEqual(8);
    record("restore", {
      databaseId: config.restoreDatabaseId,
      backupCreatedAt: manifest.createdAt,
      rpoHours,
      rtoHours,
      filesVerified: manifest.files.length,
      tablesVerified: restore.tableChecksums.length,
      resumedBusinessApi: true,
      rescannedRestoredEvidence: true,
      restoredEvidence,
      worker: `${config.workerName}-restore`,
      verifiedAt: new Date().toISOString(),
    });
  });
});
