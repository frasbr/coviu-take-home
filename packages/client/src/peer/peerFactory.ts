import Peer, { type PeerOptions } from "peerjs";
import type { MediaPeer } from "./usePeer.js";

const STUN_SERVER = "stun:stun.l.google.com:19302";

export function peerOptions(serverUrl: string): PeerOptions {
  const url = new URL(serverUrl);
  const defaultPort = url.protocol === "https:" ? 443 : 80;

  return {
    host: url.hostname,
    port: url.port === "" ? defaultPort : Number(url.port),
    path: "/peerjs",
    secure: url.protocol === "https:",
    config: { iceServers: [{ urls: STUN_SERVER }] },
  };
}

export function createBrowserPeer(serverUrl: string): MediaPeer {
  return new Peer(peerOptions(serverUrl));
}
