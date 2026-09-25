import type { CloudInput } from "./cloud-config.mjs";
export function cloudIo(
  config: CloudInput,
  env: Record<string, string | undefined>,
  transport?: typeof fetch,
): {
  cf(path: string, init?: RequestInit): Promise<any>;
  query(sql: string, params?: unknown[], database?: string): Promise<any>;
  aws(service: string, path: string, init?: RequestInit): Promise<Response>;
  r2(kind: string, key: string, init?: RequestInit): Promise<Response>;
};
export function requireResponse(response: Response): Promise<Response>;
