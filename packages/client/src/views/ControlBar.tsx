import type { ReactNode } from "react";

export interface ControlBarProps {
  status: ReactNode;
  actions: ReactNode;
}

export function ControlBar({ status, actions }: ControlBarProps) {
  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-4 bg-neutral-900 px-4 py-3 text-white">
      <div className="flex items-center gap-4">{status}</div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}
