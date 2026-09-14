import { z } from "zod";
import { EndedReasonSchema } from "./status.js";

/** `events.type` values. */
export const EventTypeSchema = z.enum([
  "session_created",
  "patient_joined_waiting_room",
  "patient_admitted",
  "patient_disconnected",
  "patient_reconnected",
  "patient_left",
  "provider_disconnected",
  "provider_reconnected",
  "session_timed_out",
  "session_ended",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/** `data` for a `session_ended` event row. */
export const SessionEndedEventDataSchema = z.object({
  reason: EndedReasonSchema,
});
export type SessionEndedEventData = z.infer<typeof SessionEndedEventDataSchema>;

/** Every other event type carries no `data`. */
export const EventDataSchema = z.union([z.null(), SessionEndedEventDataSchema]);
export type EventData = z.infer<typeof EventDataSchema>;

/** One row of the event log. */
export const EventSchema = z.object({
  id: z.number().int(),
  type: EventTypeSchema,
  occurredAt: z.string(),
  data: EventDataSchema,
});
export type Event = z.infer<typeof EventSchema>;
