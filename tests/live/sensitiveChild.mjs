import { registerHooks } from "node:module";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

// No Playwright Test runner is started in this process. Library assertion/API
// failures remain in memory and are replaced before any IPC or output.
let finished = false;
function finish(ok) {
  if (finished) return;
  finished = true;
  if (!process.connected) process.exit(1);
  process.send(ok ? "passed" : "failed", () => process.exit(ok ? 0 : 1));
}
process.on("uncaughtException", () => finish(false));
process.on("unhandledRejection", () => finish(false));
process.on("disconnect", () => process.exit(1));

// Node 24 strips types. Resolve this repository's extensionless local TS imports
// through its public loader API, without a preload or changes to node_modules.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith(".") &&
      !extname(specifier) &&
      !context.parentURL?.includes("/node_modules/")
    )
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

try {
  const { run } = await import(pathToFileURL(process.argv[2]).href);
  await run();
  finish(true);
} catch {
  finish(false);
}
