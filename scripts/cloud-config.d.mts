export type CloudInput = {
  purpose: "anonymous-trial" | "production";
  offlineOnly: boolean;
  cloudflareAccountId: string;
  awsAccountId: string;
  workerName: string;
  databaseId: string;
  restoreDatabaseId: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  scanBucket: string;
  guardDutyPlanId: string;
  openAiMode: "disabled" | "trial" | "monthly";
};
export function validateCloudInput(input: unknown): CloudInput;
export function readCloudInput(path: string, root: string): CloudInput;
export function prepareCloud(path: string, root: string, restore?: boolean): string;
export function createCloudConfig(input: CloudInput, restore?: boolean): Record<string, unknown>;
export function verifyInventory(input: CloudInput, observed: Record<string, unknown>): boolean;
export function cloudBuildSettings(
  path: string,
  root: string,
  restore?: boolean,
): { configPath: string; envDir: false; define: Record<string, string> };
export function liveOrigin(
  input: ReturnType<typeof readCloudInput>,
  value: string,
  restore?: boolean,
): string;
export function verifyCloudOutput(
  inputPath: string,
  root: string,
  deploy?: boolean,
  restore?: boolean,
): string;
