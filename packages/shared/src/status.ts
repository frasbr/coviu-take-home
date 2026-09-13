import { z } from "zod";

export const SessionStatusSchema = z.enum([
  "CREATED",
  "WAITING",
  "ACTIVE",
  "DISCONNECTED_GRACE",
  "ENDED",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const EndedReasonSchema = z.enum(["provider_ended", "timeout", "interrupted"]);
export type EndedReason = z.infer<typeof EndedReasonSchema>;

export const RoleSchema = z.enum(["provider", "patient"]);
export type Role = z.infer<typeof RoleSchema>;
