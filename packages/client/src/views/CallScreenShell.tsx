import type { ReactNode } from "react";

export interface CallScreenShellProps {
  video: ReactNode;
  bar: ReactNode;
}

// The video area is a flex sibling of the bar rather than the bar being
// position: fixed — that way the video area's height is exactly "whatever
// the bar doesn't take" with no manual offset to keep in sync.
export function CallScreenShell({ video, bar }: CallScreenShellProps) {
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-neutral-950">
      <div className="min-h-0 flex-1 overflow-hidden">{video}</div>
      {bar}
    </div>
  );
}
