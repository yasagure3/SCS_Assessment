import {
  awsCredentials,
  awsSignedFetch,
  type AwsConfiguration,
} from "../../../platform/awsSignedFetch";
import type { CognitoAdminTransport } from "./cognitoAdmin";
import { DomainError } from "../domain/authorize";
export function cognitoAdminTransport(
  config: AwsConfiguration & { COGNITO_POOL_ID?: string },
  transport: typeof fetch,
  now: () => Date,
): CognitoAdminTransport {
  return async (action, body, signal) => {
    if (
      !/^ap-northeast-1_[a-zA-Z0-9]+$/.test(config.COGNITO_POOL_ID ?? "") ||
      body.UserPoolId !== config.COGNITO_POOL_ID
    )
      throw new DomainError("SERVICE_UNAVAILABLE");
    let credentials;
    try {
      credentials = awsCredentials(config);
    } catch {
      throw new DomainError("SERVICE_UNAVAILABLE");
    }
    const result = await awsSignedFetch(
      credentials,
      "ap-northeast-1",
      "cognito-idp",
      transport,
      now,
    )("https://cognito-idp.ap-northeast-1.amazonaws.com/", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(body),
    });
    const text = await result.text();
    if (text.length > 65536) throw new Error("PROVIDER_RESPONSE_INVALID");
    const data: unknown = JSON.parse(text);
    if (!result.ok) {
      const type =
        data && typeof data === "object" && "__type" in data
          ? String(data.__type).split("#").at(-1)
          : "";
      throw new Error(type === "UserNotFoundException" ? type : "PROVIDER_FAILED");
    }
    return data;
  };
}
