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

describe("providerConnected", () => {
  it("marks the provider present, with no state transition", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");

    registry.providerConnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "CREATED",
      presence: { provider: true, patient: false },
    });
  });

  it("emits a presence event, not a transition event", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    const transitionListener = vi.fn();
    const presenceListener = vi.fn();
    registry.on("transition", transitionListener);
    registry.on("presence", presenceListener);

    registry.providerConnected("session-1");

    expect(transitionListener).not.toHaveBeenCalled();
    expect(presenceListener).toHaveBeenCalledWith({
      sessionId: "session-1",
      presence: { provider: true, patient: false },
    });
  });

  it("is idempotent and emits nothing on a second call", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.providerConnected("session-1");
    const presenceListener = vi.fn();
    registry.on("presence", presenceListener);

    registry.providerConnected("session-1");

    expect(presenceListener).not.toHaveBeenCalled();
  });

  it("throws for a session id that is not registered", () => {
    const registry = new SessionRegistry();
    expect(() => registry.providerConnected("no-such-session")).toThrow();
  });
});

describe("admit", () => {
  it("moves a WAITING session to ACTIVE", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");

    registry.admit("session-1");

    expect(registry.getSession("session-1")).toMatchObject({ status: "ACTIVE" });
  });

  it("emits a transition event with eventType patient_admitted", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.admit("session-1");

    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "WAITING",
      to: "ACTIVE",
      eventType: "patient_admitted",
      presence: { provider: false, patient: true },
    });
  });

  it("throws when the session is not in state WAITING", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");

    expect(() => registry.admit("session-1")).toThrow();
  });

  it("throws for a session id that is not registered", () => {
    const registry = new SessionRegistry();
    expect(() => registry.admit("no-such-session")).toThrow();
  });
});

describe("endSession", () => {
  it.each(["CREATED", "WAITING", "ACTIVE"] as const)(
    "moves a %s session to ENDED with reason provider_ended",
    (status) => {
      const registry = new SessionRegistry();
      registry.createSession("session-1");
      if (status !== "CREATED") {
        registry.patientConnected("session-1");
      }
      if (status === "ACTIVE") {
        registry.admit("session-1");
      }

      registry.endSession("session-1");

      expect(registry.getSession("session-1")).toMatchObject({ status: "ENDED" });
    },
  );

  it("emits a transition event with eventType session_ended and the reason", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.endSession("session-1");

    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "CREATED",
      to: "ENDED",
      eventType: "session_ended",
      endedReason: "provider_ended",
      presence: { provider: false, patient: false },
    });
  });

  it("throws when the session is already ENDED", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.endSession("session-1");

    expect(() => registry.endSession("session-1")).toThrow();
  });

  it("throws for a session id that is not registered", () => {
    const registry = new SessionRegistry();
    expect(() => registry.endSession("no-such-session")).toThrow();
  });
});

describe("patientLeft", () => {
  it("sets presence.patient false without changing the session status", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");

    registry.patientLeft("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "WAITING",
      presence: { provider: false, patient: false },
    });
  });

  it("emits a transition event with eventType patient_left and from equal to to", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.patientLeft("session-1");

    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "WAITING",
      to: "WAITING",
      eventType: "patient_left",
      presence: { provider: false, patient: false },
    });
  });

  it("throws when the session is still CREATED", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");

    expect(() => registry.patientLeft("session-1")).toThrow();
  });

  it("throws when the session has ENDED", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.endSession("session-1");

    expect(() => registry.patientLeft("session-1")).toThrow();
  });

  it("throws for a session id that is not registered", () => {
    const registry = new SessionRegistry();
    expect(() => registry.patientLeft("no-such-session")).toThrow();
  });
});

describe("patientDisconnected", () => {
  it("sets presence.patient false without changing the session status", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");

    registry.patientDisconnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "ACTIVE",
      presence: { provider: false, patient: false },
    });
  });

  it("emits a transition event with eventType patient_disconnected and from equal to to", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.patientDisconnected("session-1");

    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "WAITING",
      to: "WAITING",
      eventType: "patient_disconnected",
      presence: { provider: false, patient: false },
    });
  });

  it("is idempotent and emits nothing when the patient is already absent", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.patientLeft("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.patientDisconnected("session-1");

    expect(listener).not.toHaveBeenCalled();
  });

  it("throws when the session has ENDED", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.endSession("session-1");

    expect(() => registry.patientDisconnected("session-1")).toThrow();
  });

  it("throws for a session id that is not registered", () => {
    const registry = new SessionRegistry();
    expect(() => registry.patientDisconnected("no-such-session")).toThrow();
  });
});

describe("patientReconnected", () => {
  it("sets presence.patient true without changing the session status", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    registry.patientLeft("session-1");

    registry.patientReconnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "ACTIVE",
      presence: { provider: false, patient: true },
    });
  });

  it("emits a transition event with eventType patient_reconnected and from equal to to", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.patientLeft("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.patientReconnected("session-1");

    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "WAITING",
      to: "WAITING",
      eventType: "patient_reconnected",
      presence: { provider: false, patient: true },
    });
  });

  it("is idempotent and emits nothing when the patient is already present", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.patientReconnected("session-1");

    expect(listener).not.toHaveBeenCalled();
  });

  it("throws when the session is still CREATED", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");

    expect(() => registry.patientReconnected("session-1")).toThrow();
  });

  it("throws when the session has ENDED", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.endSession("session-1");

    expect(() => registry.patientReconnected("session-1")).toThrow();
  });

  it("throws for a session id that is not registered", () => {
    const registry = new SessionRegistry();
    expect(() => registry.patientReconnected("no-such-session")).toThrow();
  });
});
