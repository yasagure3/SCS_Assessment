import type { Context } from "hono";
import type { AppEnv } from "./app";
import { DomainError } from "../shared/errors";
export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  if (!c.req.header("Content-Type")?.toLowerCase().startsWith("application/json"))
    throw new DomainError("VALIDATION_ERROR");
  try {
    return await c.req.json();
  } catch {
    throw new DomainError("MALFORMED_JSON");
  }
}
