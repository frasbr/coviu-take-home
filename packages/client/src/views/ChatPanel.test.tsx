// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Role } from "@coviu/shared";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../peer/mergeTranscript.js";
import { ChatPanel } from "./ChatPanel.js";

afterEach(cleanup);

function message(overrides: Partial<ChatMessage> & { id: string; sender: Role }): ChatMessage {
  return {
    text: "hi",
    sentAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ChatPanel", () => {
  it("renders every message in the transcript", () => {
    const transcript = [
      message({ id: "1", sender: "provider", text: "hello" }),
      message({ id: "2", sender: "patient", text: "hi there" }),
    ];

    render(<ChatPanel transcript={transcript} isOpen localRole="provider" onSend={vi.fn()} />);

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });

  it("sends the trimmed composer text and clears it", async () => {
    const onSend = vi.fn();
    render(<ChatPanel transcript={[]} isOpen localRole="provider" onSend={onSend} />);

    const input = screen.getByLabelText("Message");
    await userEvent.type(input, "  hello there  ");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledWith("hello there");
    expect(input).toHaveValue("");
  });

  it("sends on enter", async () => {
    const onSend = vi.fn();
    render(<ChatPanel transcript={[]} isOpen localRole="provider" onSend={onSend} />);

    await userEvent.type(screen.getByLabelText("Message"), "hello{enter}");

    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not send an empty or whitespace-only message", async () => {
    const onSend = vi.fn();
    render(<ChatPanel transcript={[]} isOpen localRole="provider" onSend={onSend} />);

    await userEvent.type(screen.getByLabelText("Message"), "   {enter}");

    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the composer and explains why when the channel is not open", () => {
    render(<ChatPanel transcript={[]} isOpen={false} localRole="provider" onSend={vi.fn()} />);

    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText("Chat is unavailable")).toBeInTheDocument();
  });

  it("does not call onSend while the channel is not open", async () => {
    const onSend = vi.fn();
    render(<ChatPanel transcript={[]} isOpen={false} localRole="provider" onSend={onSend} />);

    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the send button while the draft is empty, even when open", () => {
    render(<ChatPanel transcript={[]} isOpen localRole="provider" onSend={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
