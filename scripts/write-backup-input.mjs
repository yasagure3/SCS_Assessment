import { mkdirSync, writeFileSync } from "node:fs";
import { validateCloudInput } from "./cloud-config.mjs";
const input = validateCloudInput(JSON.parse(process.env.SCS_BACKUP_INPUT ?? "null"));
if (input.purpose !== "anonymous-trial" || input.offlineOnly)
  throw new Error("Daily backup requires a verified anonymous-trial environment.");
mkdirSync(".local", { recursive: true });
writeFileSync(".local/cloud-input.json", JSON.stringify(input, null, 2) + "\n", { flag: "wx" });
