export function runSensitiveProcess(
  entry: URL,
  timeoutMs?: number,
  options?: { cwd?: string; env?: Record<string, string | undefined> },
): Promise<void>;
export function requireSensitiveProcess(): void;
