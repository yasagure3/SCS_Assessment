import type { CloudInput } from "./cloud-config.mjs";
import type { cloudIo } from "./cloud-io.mjs";
export function livePreflight(
  config: CloudInput,
  io: ReturnType<typeof cloudIo>,
  origin: string,
  restore?: boolean,
): Promise<Record<string, unknown>>;
export function withLivePreflight<T>(
  config: CloudInput,
  io: ReturnType<typeof cloudIo>,
  origin: string,
  continuation: (inventory: Record<string, unknown>) => Promise<T>,
): Promise<T>;
