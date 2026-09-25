export type BackupManifest = {
  schemaVersion: 1;
  sourceWorker: string;
  sourceDatabase: string;
  createdAt: string;
  database: { key: string; sha256: string; sizeBytes: number };
  files: { id: string; objectKey: string; key: string; sha256: string; sizeBytes: number }[];
};
export function retentionCandidates(
  contracts: { customerId: string; endedOn: string }[],
  today: string,
): { customerId: string; endedOn: string; deleteAfter: string }[];
export function validateManifest(
  manifest: unknown,
  worker: string,
  restoreDatabase: string,
  sourceDatabase?: string,
): BackupManifest;
export function hashBytes(bytes: Uint8Array | string): string;
export function restoreSql(sql: string, revokedBefore: number): string;
export function hashRows(rows: Record<string, unknown>[]): string;
