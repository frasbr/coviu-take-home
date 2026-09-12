import { z } from "zod";

/** Session lifecycle states (architecture.md §3). */
export const SessionStatusSchema = z.enum([
  "CREATED",
  "WAITING",
  "ACTIVE",
  "DISCONNECTED_GRACE",
  "ENDED",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** Reason a session reached ENDED (architecture.md §5.1). */
export const EndedReasonSchema = z.enum(["provider_ended", "timeout", "interrupted"]);
export type EndedReason = z.infer<typeof EndedReasonSchema>;

/** The role a caller holds in a session, derived from which key it presents (§4.1). */
export const RoleSchema = z.enum(["provider", "patient"]);
export type Role = z.infer<typeof RoleSchema>;
