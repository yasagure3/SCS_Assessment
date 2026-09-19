import { z } from "zod";
export type AppRole = "admin" | "staff";
export type Me = {
  id: string;
  email: string;
  role: AppRole;
  customerIds: string[];
  status: "active";
};
const ids = z
  .array(z.uuid())
  .max(100)
  .refine((values) => new Set(values).size === values.length);
export const inviteSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: z.enum(["admin", "staff"]),
  customerIds: ids,
});
export const updateUserSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  mutationId: z.uuid(),
  role: z.enum(["admin", "staff"]),
  status: z.enum(["active", "suspended"]),
});
export const membersSchema = z.strictObject({
  expectedRevision: z.int().positive(),
  mutationId: z.uuid(),
  userIds: ids,
});
export type InviteInput = z.infer<typeof inviteSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type MembersInput = z.infer<typeof membersSchema>;
export type ManagedUser = {
  id: string;
  email: string;
  role: AppRole;
  status: "invited" | "active" | "suspended";
  revision: number;
  customerIds: string[];
};
export type InvitationResult = {
  invitationId: string;
  status: "pending" | "processing" | "sent" | "failed" | "expired";
  expiresAt: string;
};
export type Invitation = InvitationResult & {
  userId: string;
  email: string;
  role: AppRole;
  userStatus: ManagedUser["status"];
  lastErrorCode: string | null;
  retryAllowed: boolean;
};
export type Members = { customerId: string; revision: number; userIds: string[] };
