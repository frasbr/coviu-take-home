import type { Role } from "@coviu/shared";
import { type FormEvent, useState } from "react";
import type { ChatMessage } from "../peer/mergeTranscript.js";

export interface ChatPanelProps {
  transcript: ChatMessage[];
  isOpen: boolean;
  localRole: Role;
  onSend: (text: string) => void;
}

export function ChatPanel({ transcript, isOpen, localRole, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!isOpen || text === "") {
      return;
    }
    onSend(text);
    setDraft("");
  }

  return (
    <div className="flex h-full flex-col bg-neutral-900 text-white">
      <h2 className="border-b border-white/10 px-3 py-2 text-sm font-semibold">Chat</h2>
      <ul aria-label="Chat messages" className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {transcript.map((message) => (
          <li
            key={message.id}
            className={message.sender === localRole ? "text-right" : "text-left"}
          >
            <p className="text-xs text-white/50">{message.sender}</p>
            <p className="inline-block rounded-lg bg-neutral-800 px-2 py-1 text-sm">
              {message.text}
            </p>
          </li>
        ))}
      </ul>
      {!isOpen && <p className="px-3 pb-1 text-xs text-white/50">Chat is unavailable</p>}
      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-white/10 p-3">
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <input
          id="chat-message"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!isOpen}
          placeholder="Type a message"
          className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-1 text-sm disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!isOpen || draft.trim() === ""}
          className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
