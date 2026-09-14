import type { ChatMessage } from "./mergeTranscript.js";

function storageKey(sessionKey: string): string {
  return `coviu:chat:${sessionKey}`;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.sender === "provider" || candidate.sender === "patient") &&
    typeof candidate.text === "string" &&
    typeof candidate.sentAt === "string"
  );
}

/**
 * Persistence is a backstop, never a precondition: an unreadable, missing or
 * full sessionStorage must degrade to a live-only session rather than break
 * chat, so every operation here swallows its own failure.
 */
export function readStoredTranscript(sessionKey: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(storageKey(sessionKey));
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isChatMessage)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

export function writeStoredTranscript(sessionKey: string, transcript: ChatMessage[]): void {
  try {
    sessionStorage.setItem(storageKey(sessionKey), JSON.stringify(transcript));
  } catch {
    // Unreadable or full sessionStorage: chat keeps working for the live session.
  }
}
