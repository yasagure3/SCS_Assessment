import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";

const poolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
const memory = new Map<string, string>();
const storage = {
  setItem: (key: string, value: string) => memory.set(key, value),
  getItem: (key: string) => memory.get(key) ?? null,
  removeItem: (key: string) => memory.delete(key),
  clear: () => memory.clear(),
};
export const userPool =
  poolId && clientId
    ? new CognitoUserPool({
        UserPoolId: poolId,
        ClientId: clientId,
        Storage: storage,
        endpoint: import.meta.env.VITE_COGNITO_ENDPOINT || undefined,
      })
    : null;

export type Session = { accessToken: string; email: string };

function toSession(session: CognitoUserSession): Session {
  return {
    accessToken: session.getAccessToken().getJwtToken(),
    email: session.getIdToken().payload.email as string,
  };
}

export function signIn(email: string, password: string): Promise<Session> {
  if (!userPool) return Promise.reject(new Error("認証サービスはまだ設定されていません。"));
  const pool = userPool;
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: pool, Storage: storage });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    user.authenticateUser(authDetails, {
      onSuccess: (session: CognitoUserSession) => {
        resolve(toSession(session));
      },
      onFailure: (err: Error) => {
        reject(err);
      },
    });
  });
}

export function getCurrentSession(): Promise<Session | null> {
  return new Promise((resolve) => {
    const user = userPool?.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        resolve(null);
        return;
      }
      resolve(toSession(session));
    });
  });
}

export function signOut(): void {
  userPool?.getCurrentUser()?.signOut();
  storage.clear();
}
