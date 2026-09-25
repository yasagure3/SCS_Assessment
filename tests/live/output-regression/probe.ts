import { chromium, expect, request, type Page, type BrowserContext } from "@playwright/test";
import { createServer as httpServer } from "node:http";
import { createServer as netServer, type AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";
import { reportPerformance } from "../reportPerformance";
import { requireSensitiveProcess } from "../sensitiveProcess.mjs";

export async function run() {
  requireSensitiveProcess();
  const kind = process.env.SCS_OUTPUT_PROBE_CASE!;
  const secret = process.env.SCS_OUTPUT_PROBE_TOKEN!;
  const password = process.env.SCS_OUTPUT_PROBE_PASSWORD!;
  const totp = process.env.SCS_OUTPUT_PROBE_TOTP!;
  const mark = (rawErrorObserved = false) =>
    writeFileSync(`${kind}.json`, JSON.stringify({ kind, rawErrorObserved }));
  if (Object.keys(process.env).some((name) => /^(DEBUG.*|PWDEBUG|NODE_DEBUG.*)$/.test(name)))
    throw new Error("Debug environment not removed.");
  if (kind === "success") {
    expect(2 + 2).toBe(4);
    mark();
    return;
  }
  if (kind === "deadline") {
    mark();
    await new Promise(() => setInterval(() => {}, 1000));
  }
  if (kind === "uncaught") {
    mark();
    setTimeout(() => {
      throw new Error(secret + password + totp);
    }, 0);
    await new Promise(() => {});
  }
  if (kind === "rejection") {
    mark();
    void Promise.reject(new Error(secret + password + totp));
    await new Promise(() => {});
  }
  if (kind === "assertion") {
    try {
      expect({ secret, password, totp }).toEqual({
        secret: "absent",
        password: "absent",
        totp: "absent",
      });
    } catch (error) {
      mark([secret, password, totp].every((value) => String(error).includes(value)));
      throw error;
    }
  }
  if (kind === "auth-page") {
    const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || undefined });
    try {
      const page = await browser.newPage();
      await page.setContent(
        `<h1>Authentication setup</h1><p>${secret}</p><label>Password<input type="password"></label><p>${totp}</p>`,
      );
      await page.getByLabel("Password").fill(password);
      try {
        await expect(page.locator("body")).toHaveText("not present", { timeout: 200 });
      } catch (error) {
        mark(String(error).includes(secret) && String(error).includes(totp));
        throw error;
      }
    } finally {
      await browser.close();
    }
  }
  const server =
    kind === "invalid-http"
      ? netServer((socket) => {
          socket.end("not-an-http-response\r\n", () => socket.destroy());
        })
      : httpServer((_req, res) => {
          if (kind !== "request-timeout") {
            res.writeHead(500);
            res.end(secret + password + totp);
          }
        });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (kind === "connection-refused")
    await new Promise<void>((resolve) => server.close(() => resolve()));
  const api = await request.newContext({ baseURL, timeout: 300, failOnStatusCode: true });
  try {
    try {
      if (kind === "performance") {
        // Real delegated function, including its preflight and first authenticated
        // API request. It fails before page/fixtures or output generation are used.
        await reportPerformance(
          undefined as unknown as Page,
          api,
          undefined as unknown as BrowserContext,
          secret,
          "anonymous-user",
          baseURL,
          async () => {
            writeFileSync("performance-preflight.json", '{"called":true}');
          },
        );
      } else {
        await api.post("/failure", {
          headers: { Authorization: `Bearer ${secret}` },
          data: { password, totp },
        });
      }
    } catch (error) {
      mark(String(error).includes(secret));
      throw error;
    }
    throw new Error("Failure probe unexpectedly returned.");
  } finally {
    await api.dispose();
    if ("closeAllConnections" in server) server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
