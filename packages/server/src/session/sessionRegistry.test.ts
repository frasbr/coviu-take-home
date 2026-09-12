import { describe, expect, it, vi } from "vitest";
import { SessionRegistry } from "./sessionRegistry.js";

describe("createSession", () => {
  it("registers a session in state CREATED with nobody present", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "CREATED",
      presence: { provider: false, patient: false },
    });
  });

  it("throws when the session id is already registered", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");

    expect(() => registry.createSession("session-1")).toThrow();
  });
});

describe("getSession", () => {
  it("returns undefined for a session that was never created", () => {
    const registry = new SessionRegistry();
    expect(registry.getSession("no-such-session")).toBeUndefined();
  });
});

describe("patientConnected", () => {
  it("moves a CREATED session to WAITING and marks the patient present", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");

    registry.patientConnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "WAITING",
      presence: { provider: false, patient: true },
    });
  });

  it("emits exactly one transition event describing the change", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.patientConnected("session-1");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "CREATED",
      to: "WAITING",
      eventType: "patient_joined_waiting_room",
      presence: { provider: false, patient: true },
    });
  });

  it("throws for a session id that is not registered", () => {
    const registry = new SessionRegistry();
    expect(() => registry.patientConnected("no-such-session")).toThrow();
  });

  it("throws when the session is not in state CREATED", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");

    expect(() => registry.patientConnected("session-1")).toThrow();
  });
});
