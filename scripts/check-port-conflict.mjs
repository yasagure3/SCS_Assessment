import { createServer } from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

// Emulate another checkout that already owns the port and answers health checks.
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end('{"status":"ok"}');
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
try {
  const port = server.address().port;
  const child = spawn(
    process.platform === "win32" ? "vp.exe" : "vp",
    ["exec", "playwright", "test", "tests/e2e/smoke.spec.ts"],
    {
      env: { ...process.env, E2E_PORT: String(port) },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    },
  );
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 1, output);
  assert.match(output, /is already used|already in use/i);
  assert.doesNotMatch(output, /Running \d+ tests?/);
  console.log("PASS: occupied port is rejected before browser tests start");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
