import { z } from "zod";

/** Error codes shared by the HTTP and Socket.IO transports (architecture.md §4.5). */
export const ErrorCodeSchema = z.enum([
  "unknown_key",
  "session_ended",
  "role_already_connected",
  "invalid_message",
  "not_allowed_in_state",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Body sent by both transports on failure: an HTTP response body, or a socket `error` event. */
export const ErrorPayloadSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
