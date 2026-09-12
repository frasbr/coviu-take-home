import { z } from "zod";
import type { ErrorPayload } from "./errors.js";
import { EndedReasonSchema, RoleSchema, SessionStatusSchema } from "./status.js";

/** `admit` (provider to server). */
export const AdmitPayloadSchema = z.object({});
export type AdmitPayload = z.infer<typeof AdmitPayloadSchema>;

/** `patient:leave` (patient to server). */
export const PatientLeavePayloadSchema = z.object({});
export type PatientLeavePayload = z.infer<typeof PatientLeavePayloadSchema>;

/** `end-session` (provider to server). */
export const EndSessionPayloadSchema = z.object({});
export type EndSessionPayload = z.infer<typeof EndSessionPayloadSchema>;

/** `peer:id` (peer to peer, relayed by the server). */
export const PeerIdPayloadSchema = z.object({
  peerId: z.string(),
});
export type PeerIdPayload = z.infer<typeof PeerIdPayloadSchema>;

/** `chat:message` (peer to peer, relayed and recorded by the server). */
export const ChatMessagePayloadSchema = z.object({
  text: z.string(),
  sentAt: z.string(),
});
export type ChatMessagePayload = z.infer<typeof ChatMessagePayloadSchema>;

/** `session:state` (server to both). */
export const SessionStatePayloadSchema = z.object({
  state: SessionStatusSchema,
  since: z.string(),
  reason: EndedReasonSchema.nullable(),
  presence: z.object({
    provider: z.boolean(),
    patient: z.boolean(),
  }),
});
export type SessionStatePayload = z.infer<typeof SessionStatePayloadSchema>;

/** One entry of `chat:history`. */
export const ChatHistoryMessageSchema = z.object({
  sender: RoleSchema,
  text: z.string(),
  sentAt: z.string(),
});
export type ChatHistoryMessage = z.infer<typeof ChatHistoryMessageSchema>;

/** `chat:history` (server to one client, sent once on connection). */
export const ChatHistoryPayloadSchema = z.object({
  messages: z.array(ChatHistoryMessageSchema),
});
export type ChatHistoryPayload = z.infer<typeof ChatHistoryPayloadSchema>;

/**
 * Socket.IO event maps, built from the payload schemas above so a wrong
 * event name or payload shape fails `tsc` before any schema runs at run time.
 */
export interface ClientToServerEvents {
  admit: (payload: AdmitPayload) => void;
  "peer:id": (payload: PeerIdPayload) => void;
  "chat:message": (payload: ChatMessagePayload) => void;
  "patient:leave": (payload: PatientLeavePayload) => void;
  "end-session": (payload: EndSessionPayload) => void;
}

export interface ServerToClientEvents {
  "session:state": (payload: SessionStatePayload) => void;
  "peer:id": (payload: PeerIdPayload) => void;
  "chat:message": (payload: ChatMessagePayload) => void;
  "chat:history": (payload: ChatHistoryPayload) => void;
  error: (payload: ErrorPayload) => void;
}
