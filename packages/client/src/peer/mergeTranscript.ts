import type { Role } from "@coviu/shared";

export interface ChatMessage {
  id: string;
  sender: Role;
  text: string;
  sentAt: string;
}

/**
 * Merges two transcripts into one, deduplicated by message id and ordered by
 * sentAt. Ties break on id so the result is stable regardless of argument
 * order — every reconnect correctness property in the plan reduces to this.
 */
export function mergeTranscript(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of [...a, ...b]) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort((x, y) => {
    if (x.sentAt !== y.sentAt) {
      return x.sentAt < y.sentAt ? -1 : 1;
    }
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}
