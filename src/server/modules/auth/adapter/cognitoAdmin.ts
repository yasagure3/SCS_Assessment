import { z } from "zod";
import { DomainError } from "../domain/authorize";
import type { CognitoAdministration } from "../domain/accessManagement";

// The transport must sign IAM requests and honor AbortSignal. F04 supplies it only
// after the real pool, immutable reservation attribute and IAM policy are verified.
export type CognitoAdminTransport = (
  action: "AdminGetUser" | "AdminCreateUser",
  body: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;
const attributes = z.array(z.object({ Name: z.string(), Value: z.string() }));
function subject(values: unknown, id: string): string {
  const parsed = attributes.parse(values),
    sub = parsed.find((item) => item.Name === "sub")?.Value;
  if (!sub || parsed.find((item) => item.Name === "custom:app_user_id")?.Value !== id)
    throw new Error("PROVIDER_IDENTITY_MISMATCH");
  return sub;
}
export function cognitoAdmin(configuration?: {
  poolId: string;
  transport: CognitoAdminTransport;
}): CognitoAdministration {
  async function call(action: "AdminGetUser" | "AdminCreateUser", body: Record<string, unknown>) {
    if (!configuration || !/^[-\w]+_[a-zA-Z0-9]+$/.test(configuration.poolId))
      throw new DomainError("SERVICE_UNAVAILABLE");
    const signal = AbortSignal.timeout(5000);
    try {
      return await Promise.race([
        configuration.transport(action, { UserPoolId: configuration.poolId, ...body }, signal),
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DomainError("PROVIDER_TIMEOUT")), {
            once: true,
          });
        }),
      ]);
    } catch (error) {
      if (signal.aborted) throw new DomainError("PROVIDER_TIMEOUT");
      throw error;
    }
  }
  async function existing(username: string, id: string) {
    const data = z
      .object({ UserAttributes: attributes })
      .parse(await call("AdminGetUser", { Username: username }));
    return subject(data.UserAttributes, id);
  }
  return {
    async provision(user) {
      try {
        return await existing(user.email, user.id);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "UserNotFoundException") throw error;
      }
      const data = z.object({ User: z.object({ Attributes: attributes }) }).parse(
        await call("AdminCreateUser", {
          Username: user.email,
          MessageAction: "SUPPRESS",
          DesiredDeliveryMediums: ["EMAIL"],
          ForceAliasCreation: false,
          UserAttributes: [
            { Name: "email", Value: user.email },
            { Name: "custom:app_user_id", Value: user.id },
          ],
        }),
      );
      return subject(data.User.Attributes, user.id);
    },
    async sendInvitation(user) {
      if ((await existing(user.sub, user.id)) !== user.sub)
        throw new Error("PROVIDER_IDENTITY_MISMATCH");
      await call("AdminCreateUser", {
        Username: user.sub,
        MessageAction: "RESEND",
        DesiredDeliveryMediums: ["EMAIL"],
        ForceAliasCreation: false,
      });
    },
  };
}
