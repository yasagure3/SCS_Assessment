import {
  expect,
  type Locator,
  type Page,
  type APIRequestContext,
  type BrowserContext,
} from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readCloudInput } from "../../scripts/cloud-config.mjs";
import { cloudIo, requireResponse } from "../../scripts/cloud-io.mjs";
import { reportPerformance } from "./reportPerformance";
import { livePreflight } from "../../scripts/live-preflight.mjs";
import { requireSensitiveProcess } from "./sensitiveProcess.mjs";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Required live input missing: ${name}`);
  return value;
}
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = Array.from(secret.replaceAll("=", "").toUpperCase(), (letter) =>
    alphabet.indexOf(letter).toString(2).padStart(5, "0"),
  ).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((value) => parseInt(value, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest(),
    offset = digest[19] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
async function secretFill(locator: Locator, value: string) {
  // This flow runs only inside the process that withholds raw SDK exceptions.
  try {
    await locator.fill(value);
  } catch {
    throw new Error("Live credential field unavailable.");
  }
}
export async function liveAuthFlow(
  page: Page,
  request: APIRequestContext,
  context: BrowserContext,
) {
  requireSensitiveProcess();
  const config = readCloudInput(required("SCS_CLOUD_INPUT"), process.cwd()),
    io = cloudIo(config, process.env);
  const email = required("SCS_LIVE_TEST_EMAIL"),
    password = required("SCS_LIVE_PASSWORD"),
    temporary = required("SCS_LIVE_TEMP_PASSWORD"),
    operator = required("SCS_LIVE_OPERATOR_ACCESS_TOKEN");
  if (required("SCS_LIVE_MAILBOX_CONFIRMED") !== email)
    throw new Error("Use only the explicitly approved test mailbox.");
  const preflight = () => livePreflight(config, io, required("SCS_LIVE_BASE_URL"));
  await preflight();
  let token = "";
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/me")) token = req.headers().authorization ?? "";
  });
  const login = async (pass: string) => {
    await page.goto("/login");
    await page.getByLabel("メールアドレス").fill(email);
    await secretFill(page.getByLabel("パスワード", { exact: true }), pass);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
  };
  const enroll = async () => {
    await expect(page.getByRole("heading", { name: "認証アプリの登録" })).toBeVisible();
    const secret = await page.getByLabel("セットアップキー").textContent();
    if (!secret) throw new Error("TOTP setup missing.");
    await secretFill(page.getByLabel("認証コード"), totp(secret));
    await page.getByRole("button", { name: "認証する" }).click();
    await expect(page.getByRole("heading", { name: "担当者アカウント" })).toBeVisible();
    return secret;
  };
  await login(temporary);
  await expect(page.getByRole("heading", { name: "初回パスワードの変更" })).toBeVisible();
  await secretFill(page.getByLabel("新しいパスワード"), password);
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  const firstSecret = await enroll();
  const me = await request.get("/api/v1/me", { headers: { Authorization: token } });
  expect(me.status()).toBe(200);
  const user = (await me.json()).data;
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
  const oldToken = token;
  await page.getByRole("button", { name: "全端末からログアウト" }).click();
  await expect(page.getByRole("heading", { name: "担当者ログイン" })).toBeVisible();
  expect((await request.get("/api/v1/me", { headers: { Authorization: oldToken } })).status()).toBe(
    401,
  );
  await page.waitForTimeout(6000);
  await login(password);
  await expect(page.getByRole("heading", { name: "多要素認証" })).toBeVisible();
  const correct = totp(firstSecret),
    wrong = String((Number(correct) + 1) % 1000000).padStart(6, "0");
  await secretFill(page.getByLabel("認証コード"), wrong);
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await secretFill(page.getByLabel("認証コード"), totp(firstSecret));
  await page.getByRole("button", { name: "認証する" }).click();
  await expect(page.getByRole("heading", { name: "担当者アカウント" })).toBeVisible();
  const authenticatedToken = token;
  const changeStatus = async (status: "active" | "suspended") => {
    const listed = await request.get("/api/v1/users?limit=100", {
      headers: { Authorization: `Bearer ${operator}` },
    });
    expect(listed.status()).toBe(200);
    const current = (await listed.json()).data.items.find(
      (entry: { id: string }) => entry.id === user.id,
    );
    if (!current) throw new Error("Dedicated test user missing.");
    const changed = await request.patch(`/api/v1/users/${user.id}`, {
      headers: { Authorization: `Bearer ${operator}` },
      data: {
        expectedRevision: current.revision,
        mutationId: randomUUID(),
        role: current.role,
        status,
      },
    });
    expect(changed.status()).toBe(200);
  };
  await changeStatus("suspended");
  expect(
    (await request.get("/api/v1/me", { headers: { Authorization: authenticatedToken } })).status(),
  ).toBe(403);
  const sub = JSON.parse(
    Buffer.from(authenticatedToken.slice(7).split(".")[1], "base64url").toString("utf8"),
  ).sub;
  for (const action of ["AdminUserGlobalSignOut", "AdminDeleteSoftwareToken"])
    await requireResponse(
      await io.aws("cognito", "/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
        },
        body: JSON.stringify({ UserPoolId: config.cognitoUserPoolId, Username: sub }),
      }),
    );
  await changeStatus("active");
  await page.context().clearCookies();
  await page.reload();
  await page.waitForTimeout(6000);
  await login(password);
  const recovered = await enroll();
  expect(recovered === firstSecret).toBe(false);
  expect(
    (await request.get("/api/v1/me", { headers: { Authorization: authenticatedToken } })).status(),
  ).toBe(401);
  await reportPerformance(
    page,
    request,
    context,
    operator,
    user.id,
    new URL(page.url()).origin,
    preflight,
  );
  mkdirSync(".local/live", { recursive: true });
  writeFileSync(
    ".local/live/auth-results.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        worker: config.workerName,
        enrollment: true,
        requiredTotp: true,
        invalidTotpRejected: true,
        revocation: true,
        suspension: true,
        recovery: true,
        sameUserId: user.id,
      },
      null,
      2,
    ) + "\n",
  );
}
