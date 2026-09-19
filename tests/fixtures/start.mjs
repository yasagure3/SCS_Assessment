import { spawn } from "node:child_process";
const vp = process.platform === "win32" ? "vp.exe" : "vp";
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid fixture port");
function run(args) {
  const child = spawn(vp, args, { stdio: "inherit", windowsHide: true });
  process.once("SIGTERM", () => child.kill());
  process.once("SIGINT", () => child.kill());
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`Fixture exited: ${code}`)),
    );
  });
}
await run([
  "exec",
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "scs-test-fixture",
  "--local",
  "--config",
  "tests/fixtures/wrangler.jsonc",
  "--persist-to",
  ".local/e2e-state",
]);
await run([
  "dev",
  "--config",
  "tests/fixtures/vite.config.ts",
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
  "--strictPort",
]);
