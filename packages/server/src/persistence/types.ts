import type { EndedReason, SessionStatus } from "@coviu/shared";

export interface Session {
  id: string;
  providerKey: string;
  patientKey: string;
  status: SessionStatus;
  createdAt: string;
  endedAt: string | null;
  endedReason: EndedReason | null;
}
