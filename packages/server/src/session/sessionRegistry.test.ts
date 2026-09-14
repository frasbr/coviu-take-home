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

  it("restores an ACTIVE session after a reconnect from DISCONNECTED_GRACE", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    registry.providerConnected("session-1");
    registry.providerDisconnected("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.providerConnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "ACTIVE",
      presence: { provider: true, patient: true },
    });
    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "DISCONNECTED_GRACE",
      to: "ACTIVE",
      eventType: "provider_reconnected",
      presence: { provider: true, patient: true },
    });
  });

  it("restores a WAITING session after a reconnect from DISCONNECTED_GRACE", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.providerConnected("session-1");
    registry.providerDisconnected("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.providerConnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "WAITING",
      presence: { provider: true, patient: true },
    });
    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "DISCONNECTED_GRACE",
      to: "WAITING",
      eventType: "provider_reconnected",
      presence: { provider: true, patient: true },
    });
  });

  it("cancels the grace timer on reconnect, so the session never times out", async () => {
    const registry = new SessionRegistry({ gracePeriodMs: 5 });
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    registry.providerDisconnected("session-1");

    registry.providerConnected("session-1");
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(registry.getSession("session-1")).toMatchObject({ status: "ACTIVE" });
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

  it("cancels the pending grace timer, so no timeout events fire after the original grace period", async () => {
    const registry = new SessionRegistry({ gracePeriodMs: 5 });
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    registry.providerDisconnected("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.endSession("session-1");
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "session_ended", endedReason: "provider_ended" }),
    );
    expect(registry.getSession("session-1")).toMatchObject({ status: "ENDED" });
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

  it("moves an ACTIVE session back to WAITING, so a rejoin needs re-admitting", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");

    registry.patientLeft("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "WAITING",
      presence: { provider: false, patient: false },
    });
  });

  it("emits a transition event from ACTIVE to WAITING", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.patientLeft("session-1");

    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "ACTIVE",
      to: "WAITING",
      eventType: "patient_left",
      presence: { provider: false, patient: false },
    });
  });

  it("demotes the remembered state to WAITING when the patient leaves during grace", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    registry.providerConnected("session-1");
    registry.providerDisconnected("session-1");

    registry.patientLeft("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "DISCONNECTED_GRACE",
      presence: { provider: false, patient: false },
    });

    registry.providerConnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "WAITING",
      presence: { provider: true, patient: false },
    });
  });

  it("still emits a same-state patient_left transition while DISCONNECTED_GRACE", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    registry.providerDisconnected("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.patientLeft("session-1");

    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "DISCONNECTED_GRACE",
      to: "DISCONNECTED_GRACE",
      eventType: "patient_left",
      presence: { provider: false, patient: false },
    });
  });

  it("leaves the remembered state as WAITING when it was already WAITING", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.providerConnected("session-1");
    registry.providerDisconnected("session-1");

    registry.patientLeft("session-1");
    registry.providerConnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "WAITING",
      presence: { provider: true, patient: false },
    });
  });
});

describe("providerDisconnected", () => {
  it("moves an ACTIVE session to DISCONNECTED_GRACE and clears provider presence", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    registry.providerConnected("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.providerDisconnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "DISCONNECTED_GRACE",
      presence: { provider: false, patient: true },
    });
    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "ACTIVE",
      to: "DISCONNECTED_GRACE",
      eventType: "provider_disconnected",
      presence: { provider: false, patient: true },
    });
  });

  it("moves a WAITING session to DISCONNECTED_GRACE", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    const listener = vi.fn();
    registry.on("transition", listener);

    registry.providerDisconnected("session-1");

    expect(registry.getSession("session-1")).toMatchObject({ status: "DISCONNECTED_GRACE" });
    expect(listener).toHaveBeenCalledWith({
      sessionId: "session-1",
      from: "WAITING",
      to: "DISCONNECTED_GRACE",
      eventType: "provider_disconnected",
      presence: { provider: false, patient: true },
    });
  });

  it("from CREATED clears provider presence, keeps status, and emits presence only", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.providerConnected("session-1");
    const transitionListener = vi.fn();
    const presenceListener = vi.fn();
    registry.on("transition", transitionListener);
    registry.on("presence", presenceListener);

    registry.providerDisconnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "CREATED",
      presence: { provider: false, patient: false },
    });
    expect(transitionListener).not.toHaveBeenCalled();
    expect(presenceListener).toHaveBeenCalledWith({
      sessionId: "session-1",
      presence: { provider: false, patient: false },
    });
  });

  it("does nothing when the session has ENDED", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.endSession("session-1");
    const transitionListener = vi.fn();
    const presenceListener = vi.fn();
    registry.on("transition", transitionListener);
    registry.on("presence", presenceListener);

    registry.providerDisconnected("session-1");

    expect(registry.getSession("session-1")).toMatchObject({ status: "ENDED" });
    expect(transitionListener).not.toHaveBeenCalled();
    expect(presenceListener).not.toHaveBeenCalled();
  });

  it("throws for a session id that is not registered", () => {
    const registry = new SessionRegistry();
    expect(() => registry.providerDisconnected("no-such-session")).toThrow();
  });

  it("ends the session with reason timeout after the grace period elapses, in event order", async () => {
    const registry = new SessionRegistry({ gracePeriodMs: 5 });
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    const events: string[] = [];
    registry.on("transition", (event) => events.push(event.eventType));

    registry.providerDisconnected("session-1");
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(registry.getSession("session-1")).toMatchObject({ status: "ENDED" });
    expect(events).toEqual(["provider_disconnected", "session_timed_out", "session_ended"]);
  });

  it("is a no-op while already DISCONNECTED_GRACE, and does not restart the timer", async () => {
    const gracePeriodMs = 15;
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");
    const graceTimerCalls = () =>
      setTimeoutSpy.mock.calls.filter((call) => call[1] === gracePeriodMs).length;

    const registry = new SessionRegistry({ gracePeriodMs });
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    registry.providerDisconnected("session-1");

    expect(graceTimerCalls()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const listener = vi.fn();
    registry.on("transition", listener);
    registry.providerDisconnected("session-1");

    expect(listener).not.toHaveBeenCalled();
    expect(graceTimerCalls()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(registry.getSession("session-1")).toMatchObject({ status: "ENDED" });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "session_timed_out" }),
    );
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ eventType: "session_ended" }));

    setTimeoutSpy.mockRestore();
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
    registry.patientDisconnected("session-1");

    registry.patientReconnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "ACTIVE",
      presence: { provider: false, patient: true },
    });
  });

  it("stays in WAITING after a reconnect that follows a deliberate leave from ACTIVE", () => {
    const registry = new SessionRegistry();
    registry.createSession("session-1");
    registry.patientConnected("session-1");
    registry.admit("session-1");
    registry.patientLeft("session-1");

    registry.patientReconnected("session-1");

    expect(registry.getSession("session-1")).toEqual({
      status: "WAITING",
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
