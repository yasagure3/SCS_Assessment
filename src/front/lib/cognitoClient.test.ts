import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { IAuthenticationCallback, CognitoUserSession } from "amazon-cognito-identity-js";
const sdk = vi.hoisted(() => ({
  callbacks: null as IAuthenticationCallback | null,
  storage: null as {
    setItem: (k: string, v: string) => unknown;
    getItem: (k: string) => unknown;
  } | null,
  users: [] as unknown[],
}));
vi.mock("amazon-cognito-identity-js", () => ({
  CognitoUserPool: class {
    getCurrentUser() {
      return null;
    }
  },
  AuthenticationDetails: class {},
  CognitoUser: class {
    constructor(options: { Storage: typeof sdk.storage }) {
      sdk.storage = options.Storage;
      sdk.users.push(this);
    }
    authenticateUser(_details: unknown, callbacks: IAuthenticationCallback) {
      sdk.callbacks = callbacks;
    }
    completeNewPasswordChallenge(
      _password: string,
      _attributes: unknown,
      callbacks: IAuthenticationCallback,
    ) {
      sdk.callbacks = callbacks;
    }
    associateSoftwareToken(callbacks: { associateSecretCode: (secret: string) => void }) {
      callbacks.associateSecretCode("TEST-SECRET");
    }
    verifySoftwareToken(_code: string, _name: string, callbacks: IAuthenticationCallback) {
      sdk.callbacks = callbacks;
    }
    sendMFACode(_code: string, callbacks: IAuthenticationCallback) {
      sdk.callbacks = callbacks;
    }
  },
}));
const session = {
  getAccessToken: () => ({ getJwtToken: () => "token" }),
  getIdToken: () => ({ payload: { email: "test@example.invalid" } }),
} as unknown as CognitoUserSession;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "ap-northeast-1_test");
  vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client");
  sdk.callbacks = null;
  sdk.storage = null;
  sdk.users = [];
});
describe("in-memory Cognito MFA flow", () => {
  it("changes the HTTP retry generation for logout and every new login, including the same email", async () => {
    const auth = await import("./cognitoClient");
    const initial = auth.getSessionGeneration();
    const login = auth.signIn("test@example.invalid", "password");
    const duringLogin = auth.getSessionGeneration();
    sdk.callbacks!.totpRequired!("SOFTWARE_TOKEN_MFA", {});
    await login;
    const challenge = auth.completeTotp("123456");
    sdk.callbacks!.onSuccess(session);
    await challenge;
    const authenticated = auth.getSessionGeneration();
    auth.signOut();
    const loggedOut = auth.getSessionGeneration();
    const nextLogin = auth.signIn("test@example.invalid", "password");
    const sameUserLogin = auth.getSessionGeneration();
    sdk.callbacks!.totpRequired!("SOFTWARE_TOKEN_MFA", {});
    await nextLogin;
    expect({ duringLogin, authenticated, loggedOut, sameUserLogin }).toEqual({
      duringLogin: initial + 1,
      authenticated: initial + 1,
      loggedOut: initial + 2,
      sameUserLogin: initial + 3,
    });
  });
  it("keeps the app logged out when the provider is not configured", async () => {
    vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "");
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "");
    const auth = await import("./cognitoClient");
    expect(await auth.getCurrentSession()).toBeNull();
    await expect(auth.signIn("test@example.invalid", "password")).rejects.toThrow(
      "設定されていません",
    );
  });
  it("keeps the initial-password and TOTP enrollment challenges separate from an authenticated session", async () => {
    const auth = await import("./cognitoClient");
    const login = auth.signIn("test@example.invalid", "temporary");
    sdk.callbacks!.newPasswordRequired!({}, []);
    expect(await login).toEqual({ kind: "new-password" });
    expect(await auth.getCurrentSession()).toBeNull();
    const password = auth.completeNewPassword("replacement-password");
    sdk.callbacks!.mfaSetup!("MFA_SETUP", {});
    expect(await password).toEqual({ kind: "totp-setup", secret: "TEST-SECRET" });
    expect(await auth.getCurrentSession()).toBeNull();
    const challenge = auth.completeTotp("123456");
    sdk.callbacks!.onSuccess(session);
    expect(await challenge).toEqual({
      kind: "signed-in",
      session: { accessToken: "token", email: "test@example.invalid" },
    });
  });
  it("rejects a provider which issues a session without a TOTP challenge", async () => {
    const auth = await import("./cognitoClient");
    const login = auth.signIn("test@example.invalid", "password");
    const rejected = expect(login).rejects.toThrow("多要素認証");
    sdk.callbacks!.onSuccess(session);
    await rejected;
    expect(await auth.getCurrentSession()).toBeNull();
  });
  it("ignores late SDK writes and callbacks after cancellation", async () => {
    const auth = await import("./cognitoClient");
    const login = auth.signIn("test@example.invalid", "password");
    sdk.callbacks!.totpRequired!("SOFTWARE_TOKEN_MFA", {});
    expect(await login).toEqual({ kind: "totp" });
    const challenge = auth.completeTotp("123456"),
      oldStorage = sdk.storage!,
      callback = sdk.callbacks!;
    const rejected = expect(challenge).rejects.toThrow("中断");
    auth.signOut();
    oldStorage.setItem("late-token", "must-not-survive");
    callback.onSuccess(session);
    await rejected;
    expect(oldStorage.getItem("late-token")).toBeNull();
    expect(await auth.getCurrentSession()).toBeNull();
    expect(localStorage.length).toBe(0);
  });
  it("allows retrying an incorrect TOTP code but does not expose raw provider errors", async () => {
    const auth = await import("./cognitoClient");
    const login = auth.signIn("test@example.invalid", "password");
    sdk.callbacks!.totpRequired!("SOFTWARE_TOKEN_MFA", {});
    await login;
    const challenge = auth.completeTotp("123456");
    const rejected = expect(challenge).rejects.toThrow("認証コード");
    sdk.callbacks!.onFailure(
      Object.assign(new Error("private provider details"), { code: "CodeMismatchException" }),
    );
    await rejected;
    const retry = auth.completeTotp("654321");
    sdk.callbacks!.onSuccess(session);
    expect((await retry).kind).toBe("signed-in");
  });
});
