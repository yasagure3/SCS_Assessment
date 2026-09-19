import { describe, expect, it } from "vitest";
import {
  cognitoAdmin,
  type CognitoAdminTransport,
} from "../../src/server/modules/auth/adapter/cognitoAdmin";

describe("Cognito administration boundary", () => {
  it("recovers a lost create response only when the immutable reservation matches and resends the same subject", async () => {
    const calls: { action: string; body: Record<string, unknown> }[] = [],
      id = "reservation",
      email = "invite@example.invalid",
      sub = "reserved-sub";
    let created = false;
    const transport: CognitoAdminTransport = async (action, body) => {
      calls.push({ action, body });
      if (action === "AdminGetUser") {
        if (!created) throw new Error("UserNotFoundException");
        return {
          UserAttributes: [
            { Name: "sub", Value: sub },
            { Name: "custom:app_user_id", Value: id },
          ],
        };
      }
      if (body.MessageAction === "SUPPRESS") {
        created = true;
        throw new Error("connection lost");
      }
      return {};
    };
    const provider = cognitoAdmin({ poolId: "ap-northeast-1_test", transport });
    await expect(provider.provision({ id, email })).rejects.toThrow("connection lost");
    expect(await provider.provision({ id, email })).toBe(sub);
    await provider.sendInvitation({ id, email, sub });
    expect(calls).toEqual([
      { action: "AdminGetUser", body: { UserPoolId: "ap-northeast-1_test", Username: email } },
      {
        action: "AdminCreateUser",
        body: {
          UserPoolId: "ap-northeast-1_test",
          Username: email,
          MessageAction: "SUPPRESS",
          DesiredDeliveryMediums: ["EMAIL"],
          ForceAliasCreation: false,
          UserAttributes: [
            { Name: "email", Value: email },
            { Name: "custom:app_user_id", Value: id },
          ],
        },
      },
      { action: "AdminGetUser", body: { UserPoolId: "ap-northeast-1_test", Username: email } },
      { action: "AdminGetUser", body: { UserPoolId: "ap-northeast-1_test", Username: sub } },
      {
        action: "AdminCreateUser",
        body: {
          UserPoolId: "ap-northeast-1_test",
          Username: sub,
          MessageAction: "RESEND",
          DesiredDeliveryMediums: ["EMAIL"],
          ForceAliasCreation: false,
        },
      },
    ]);
  });
  it("rejects another reservation instead of linking by email and fails closed without configuration", async () => {
    const calls: string[] = [];
    const provider = cognitoAdmin({
      poolId: "ap-northeast-1_test",
      transport: async (action) => {
        calls.push(action);
        return {
          UserAttributes: [
            { Name: "sub", Value: "other-sub" },
            { Name: "custom:app_user_id", Value: "other-reservation" },
          ],
        };
      },
    });
    await expect(
      provider.provision({ id: "ours", email: "invite@example.invalid" }),
    ).rejects.toThrow("PROVIDER_IDENTITY_MISMATCH");
    expect(calls).toEqual(["AdminGetUser"]);
    await expect(
      cognitoAdmin().provision({ id: "ours", email: "invite@example.invalid" }),
    ).rejects.toThrow("SERVICE_UNAVAILABLE");
  });
});
