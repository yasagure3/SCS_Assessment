import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
  type IAuthenticationCallback,
} from "amazon-cognito-identity-js";

export type Session = { accessToken: string; email: string };
export type AuthResult =
  | { kind: "signed-in"; session: Session }
  | { kind: "new-password" }
  | { kind: "totp" }
  | { kind: "totp-setup"; secret: string };
const memory = new Map<string, string>();
let generation = 0;
let authenticated = false;
let sessionRequest: Promise<Session | null> | null = null;
function memoryStorage(epoch: number) {
  return {
    setItem: (key: string, value: string) => {
      if (epoch === generation) memory.set(key, value);
    },
    getItem: (key: string) => (epoch === generation ? (memory.get(key) ?? null) : null),
    removeItem: (key: string) => {
      if (epoch === generation) memory.delete(key);
    },
    clear: () => {
      if (epoch === generation) memory.clear();
    },
  };
}
const poolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
// The pool reads the current generation; each asynchronous user operation gets an epoch-bound store.
export const userPool =
  poolId && clientId
    ? new CognitoUserPool({
        UserPoolId: poolId,
        ClientId: clientId,
        Storage: {
          getItem: (key: string) => memory.get(key) ?? null,
          setItem: (key: string, value: string) => {
            memory.set(key, value);
          },
          removeItem: (key: string) => {
            memory.delete(key);
          },
          clear: () => memory.clear(),
        },
        endpoint: import.meta.env.DEV
          ? import.meta.env.VITE_COGNITO_ENDPOINT || undefined
          : undefined,
      })
    : null;
type Flow = {
  user: CognitoUser;
  epoch: number;
  step: "password" | "new-password" | "totp" | "totp-setup";
  mfaSubmitted: boolean;
};
let flow: Flow | null = null;
function current(value: Flow) {
  return flow === value && value.epoch === generation;
}
function toSession(session: CognitoUserSession): Session {
  return {
    accessToken: session.getAccessToken().getJwtToken(),
    email: String(session.getIdToken().payload.email ?? ""),
  };
}
function publicError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  if (code === "CodeMismatchException" || code === "ExpiredCodeException")
    return new Error(
      "認証コードが正しくないか、有効期限が切れています。最新のコードを入力してください。",
    );
  if (code === "InvalidPasswordException")
    return new Error("パスワードは12文字以上で、大文字・小文字・数字・記号を含めてください。");
  if (code === "TooManyRequestsException" || code === "LimitExceededException")
    return new Error("試行回数が多いため、しばらく待ってから再度お試しください。");
  return new Error(
    "ログインできませんでした。入力内容を確認し、招待期限切れや認証端末の紛失は管理者へ連絡してください。",
  );
}
function perform(
  value: Flow,
  run: (callbacks: IAuthenticationCallback) => void,
): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const live = () => {
      if (current(value)) return true;
      reject(new Error("ログイン操作は中断されました。"));
      return false;
    };
    const fail = (error: unknown) => {
      if (live()) reject(publicError(error));
    };
    const unsupported = () => {
      if (live()) {
        signOut();
        reject(new Error("多要素認証の設定を管理者へ確認してください。"));
      }
    };
    const callbacks: IAuthenticationCallback = {
      onSuccess: (session) => {
        if (!live()) return;
        if (!value.mfaSubmitted) {
          unsupported();
          return;
        }
        authenticated = true;
        flow = null;
        resolve({ kind: "signed-in", session: toSession(session) });
      },
      onFailure: fail,
      newPasswordRequired: (_attributes, requiredAttributes) => {
        if (!live()) return;
        if (requiredAttributes?.length) {
          unsupported();
          return;
        }
        value.step = "new-password";
        resolve({ kind: "new-password" });
      },
      totpRequired: () => {
        if (live()) {
          value.step = "totp";
          resolve({ kind: "totp" });
        }
      },
      mfaSetup: () => {
        if (!live()) return;
        value.user.associateSoftwareToken({
          onFailure: fail,
          associateSecretCode: (secret) => {
            if (live()) {
              value.step = "totp-setup";
              resolve({ kind: "totp-setup", secret });
            }
          },
        });
      },
      mfaRequired: unsupported,
      customChallenge: unsupported,
      selectMFAType: unsupported,
    };
    if (live()) run(callbacks);
  });
}
export function signIn(email: string, password: string): Promise<AuthResult> {
  signOut();
  if (!userPool) return Promise.reject(new Error("認証サービスはまだ設定されていません。"));
  const value: Flow = {
    user: new CognitoUser({ Username: email, Pool: userPool, Storage: memoryStorage(generation) }),
    epoch: generation,
    step: "password",
    mfaSubmitted: false,
  };
  flow = value;
  return perform(value, (callbacks) =>
    value.user.authenticateUser(
      new AuthenticationDetails({ Username: email, Password: password }),
      callbacks,
    ),
  );
}
export function completeNewPassword(password: string): Promise<AuthResult> {
  const value = flow;
  if (!value || value.step !== "new-password")
    return Promise.reject(new Error("ログインを最初からやり直してください。"));
  return perform(value, (callbacks) =>
    value.user.completeNewPasswordChallenge(password, {}, callbacks),
  );
}
export function completeTotp(code: string): Promise<AuthResult> {
  const value = flow;
  if (!value || !["totp", "totp-setup"].includes(value.step))
    return Promise.reject(new Error("ログインを最初からやり直してください。"));
  if (!/^\d{6}$/.test(code))
    return Promise.reject(new Error("認証コードは6桁の数字で入力してください。"));
  value.mfaSubmitted = true;
  return perform(value, (callbacks) =>
    value.step === "totp-setup"
      ? value.user.verifySoftwareToken(code, "SCS担当者", callbacks)
      : value.user.sendMFACode(code, callbacks, "SOFTWARE_TOKEN_MFA"),
  );
}
// A new login (even for the same email) starts a new generation via signOut.
// Token renewal stays within this generation; HTTP retries must stay there too.
export function getSessionGeneration(): number {
  return generation;
}
export function getCurrentSession(): Promise<Session | null> {
  if (sessionRequest) return sessionRequest;
  const epoch = generation;
  const currentUser = authenticated ? userPool?.getCurrentUser() : null;
  if (!currentUser || !userPool) return Promise.resolve(null);
  const user = new CognitoUser({
    Username: currentUser.getUsername(),
    Pool: userPool,
    Storage: memoryStorage(epoch),
  });
  const pending = new Promise<Session | null>((resolve) =>
    user.getSession((error: Error | null, session: CognitoUserSession | null) => {
      if (epoch !== generation || !authenticated || error || !session?.isValid()) {
        resolve(null);
        return;
      }
      resolve(toSession(session));
    }),
  );
  sessionRequest = pending;
  void pending.finally(() => {
    if (sessionRequest === pending) sessionRequest = null;
  });
  return pending;
}
export function signOut(): void {
  generation++;
  authenticated = false;
  sessionRequest = null;
  flow = null;
  memory.clear();
}
