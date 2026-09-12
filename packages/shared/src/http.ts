import { z } from "zod";
import { EventSchema } from "./events.js";
import { RoleSchema, SessionStatusSchema } from "./status.js";

/** `POST /api/sessions` has no body. */
export const CreateSessionRequestSchema = z.object({});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

/** `POST /api/sessions` response (architecture.md §4.2). */
export const CreateSessionResponseSchema = z.object({
  providerKey: z.string(),
  patientKey: z.string(),
  providerUrl: z.string(),
  patientUrl: z.string(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

/** `GET /api/sessions/:key` path parameters. */
export const GetSessionParamsSchema = z.object({
  key: z.string(),
});
export type GetSessionParams = z.infer<typeof GetSessionParamsSchema>;

/** `GET /api/sessions/:key` response. */
export const GetSessionResponseSchema = z.object({
  role: RoleSchema,
  status: SessionStatusSchema,
});
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;

/** `GET /api/sessions/:providerKey/events` path parameters. */
export const GetSessionEventsParamsSchema = z.object({
  providerKey: z.string(),
});
export type GetSessionEventsParams = z.infer<typeof GetSessionEventsParamsSchema>;

/** `GET /api/sessions/:providerKey/events` response. */
export const GetSessionEventsResponseSchema = z.object({
  events: z.array(EventSchema),
});
export type GetSessionEventsResponse = z.infer<typeof GetSessionEventsResponseSchema>;
