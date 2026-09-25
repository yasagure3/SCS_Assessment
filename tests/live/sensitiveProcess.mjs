import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const failure = () =>
  new Error("Sensitive live test failed; diagnostic values withheld. Do not retry automatically.");

// The Playwright runner must never own a secret-bearing API/page/expect step.
// A catch around such a step is too late: stepEnd already contains the SDK error.
export function runSensitiveProcess(entry, timeoutMs = 1800000, options = {}) {
  const env = {
    ...process.env,
    ...options.env,
    SCS_AUTH_ISOLATED: "1",
    PLAYWRIGHT_NO_COPY_PROMPT: "1",
  };
  for (const name of Object.keys(env))
    if (/^(DEBUG.*|PWDEBUG|NODE_DEBUG.*|NODE_OPTIONS|NODE_V8_COVERAGE|SSLKEYLOGFILE)$/.test(name))
      delete env[name];
  return new Promise((resolve, reject) => {
    let passed = false;
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./sensitiveChild.mjs", import.meta.url)), fileURLToPath(entry)],
      {
        cwd: options.cwd ?? process.cwd(),
        env,
        windowsHide: true,
        // No raw console or library diagnostics cross the process boundary.
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    const stop = () => child.kill();
    process.once("exit", stop);
    const timer = setTimeout(stop, timeoutMs);
    child.on("message", (message) => {
      // Never echo, stringify or attach messages, including unexpected payloads.
      if (message === "passed") passed = true;
      else passed = false;
    });
    const finish = (ok) => {
      clearTimeout(timer);
      process.removeListener("exit", stop);
      if (ok) resolve();
      else reject(failure());
    };
    child.once("error", () => finish(false));
    child.once("close", (code, signal) => finish(passed && code === 0 && signal === null));
  });
}

export function requireSensitiveProcess() {
  if (process.env.SCS_AUTH_ISOLATED !== "1" || typeof process.send !== "function") throw failure();
}
