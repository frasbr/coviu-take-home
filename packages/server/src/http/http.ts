import {
  CreateSessionRequestSchema,
  type ErrorPayload,
  GetSessionEventsParamsSchema,
  GetSessionParamsSchema,
} from "@coviu/shared";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { SessionService } from "../services/sessionService.js";

function sendError(res: Response, status: number, payload: ErrorPayload): void {
  res.status(status).json(payload);
}

export function createHttpApp(services: SessionService, clientUrl: string): Express {
  const app = express();
  app.use(cors({ origin: clientUrl }));
  app.use(express.json());

  app.post("/api/sessions", (req: Request, res: Response) => {
    const parsed = CreateSessionRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, { code: "invalid_message", message: parsed.error.message });
      return;
    }

    res.json(services.createSession());
  });

  app.get("/api/sessions/:key", (req: Request, res: Response) => {
    const parsed = GetSessionParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, 400, { code: "invalid_message", message: parsed.error.message });
      return;
    }

    const resolved = services.resolveKey(parsed.data.key);
    if (!resolved) {
      sendError(res, 404, { code: "unknown_key", message: "no session has that key" });
      return;
    }

    res.json({ role: resolved.role, status: resolved.status });
  });

  app.get("/api/sessions/:providerKey/events", (req: Request, res: Response) => {
    const parsed = GetSessionEventsParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, 400, { code: "invalid_message", message: parsed.error.message });
      return;
    }

    const events = services.getSessionEvents(parsed.data.providerKey);
    if (!events) {
      sendError(res, 404, { code: "unknown_key", message: "no session has that key" });
      return;
    }

    res.json({ events });
  });

  // Malformed JSON in the body reaches here as a SyntaxError from express.json(), not the route handler.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError) {
      sendError(res, 400, { code: "invalid_message", message: err.message });
      return;
    }
    next(err);
  });

  return app;
}
