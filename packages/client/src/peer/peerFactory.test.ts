import { describe, expect, it } from "vitest";
import { peerOptions } from "./peerFactory.js";

const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

describe("peerOptions", () => {
  it("takes the explicit port and stays insecure for a local http server", () => {
    expect(peerOptions("http://localhost:3001")).toEqual({
      host: "localhost",
      port: 3001,
      path: "/peerjs",
      secure: false,
      config: ICE_SERVERS,
    });
  });

  it("defaults to port 443 and secure for https with no explicit port", () => {
    expect(peerOptions("https://example.test")).toEqual({
      host: "example.test",
      port: 443,
      path: "/peerjs",
      secure: true,
      config: ICE_SERVERS,
    });
  });

  it("defaults to port 80 for http with no explicit port", () => {
    expect(peerOptions("http://example.test")).toMatchObject({ port: 80, secure: false });
  });

  it("keeps an explicit port on an https url", () => {
    expect(peerOptions("https://example.test:8443")).toMatchObject({ port: 8443, secure: true });
  });

  it("mounts on the server's /peerjs path and hardcodes the public STUN server", () => {
    const options = peerOptions("http://localhost:3001/");

    expect(options.path).toBe("/peerjs");
    expect(options.config).toEqual(ICE_SERVERS);
  });
});
