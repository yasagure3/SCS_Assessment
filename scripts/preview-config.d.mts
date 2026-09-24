export type PreviewInput = {
  purpose: "anonymous-preview";
  offlineOnly: boolean;
  cloudflareAccountId: string;
  workerName: string;
  databaseId: string;
  cognitoRegion: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
};
type PreviewOptions = { deploy?: boolean };
type PreviewConfig = {
  name: string;
  account_id: string;
  main: string;
  compatibility_date: string;
  workers_dev: boolean;
  preview_urls: boolean;
  assets: { directory: string; not_found_handling: string; run_worker_first: string[] };
  d1_databases: {
    binding: string;
    database_name: string;
    database_id: string;
    migrations_dir: string;
  }[];
  r2_buckets: { binding: string; bucket_name: string }[];
  vars: { COGNITO_ISSUER: string; COGNITO_CLIENT_ID: string; COGNITO_JWKS_URL: string };
};
export function validatePreviewInput(input: unknown, options?: PreviewOptions): PreviewInput;
export function createPreviewConfig(input: PreviewInput): PreviewConfig;
export function preparePreview(inputPath: string, root: string, options?: PreviewOptions): string;
export function previewBuildSettings(
  inputPath: string,
  root: string,
): {
  configPath: string;
  envDir: false;
  define: Record<string, string>;
};
export function verifyPreviewOutput(
  inputPath: string,
  root: string,
  options?: PreviewOptions,
): string;
