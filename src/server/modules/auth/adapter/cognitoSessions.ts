import type { SessionProvider } from "../domain/authorize";
export function cognitoSessions(issuer: string): SessionProvider {
  return {
    async revoke(token) {
      const url = new URL(issuer);
      if (
        url.protocol !== "https:" ||
        !/^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname)
      )
        throw new Error("PROVIDER_CONFIGURATION");
      const response = await fetch(url.origin, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AWSCognitoIdentityProviderService.GlobalSignOut",
        },
        body: JSON.stringify({ AccessToken: token }),
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("PROVIDER_FAILED");
    },
  };
}
