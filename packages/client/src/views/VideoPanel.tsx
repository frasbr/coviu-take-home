import { useEffect, useRef } from "react";

export interface VideoPanelProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  error: string | null;
  localRole?: string;
  remoteRole?: string;
}

// A MediaStream cannot reach a video element through a React prop; srcObject is
// only settable on the DOM node. Assigning null on teardown is what clears the
// last frame out of the element.
function useSrcObject(stream: MediaStream | null) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (video) {
      video.srcObject = stream;
    }
  }, [stream]);

  return ref;
}

export function VideoPanel({
  localStream,
  remoteStream,
  error,
  localRole,
  remoteRole,
}: VideoPanelProps) {
  const remoteRef = useSrcObject(remoteStream);
  const localRef = useSrcObject(localStream);

  return (
    <div className="relative w-full h-full overflow-hidden bg-neutral-900">
      <video
        ref={remoteRef}
        aria-label="Remote video"
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />
      {remoteRole && <span className="absolute top-2 left-2 text-white text-sm">{remoteRole}</span>}
      {remoteStream === null && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-neutral-800 text-white text-sm">
          <span>Waiting for the other side to join</span>
        </div>
      )}

      <div className="absolute bottom-4 right-4 w-32 h-24 z-10">
        <video
          ref={localRef}
          aria-label="Local video"
          autoPlay
          playsInline
          muted
          className="w-full h-full rounded-lg border border-white/20 object-cover"
        />
        {localRole && <span className="absolute top-1 left-1 text-white text-xs">{localRole}</span>}
        {localStream === null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg bg-neutral-800 text-white text-xs">
            <span>Waiting for the camera</span>
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-black/70 text-white"
        >
          {error}
        </p>
      )}
    </div>
  );
}
