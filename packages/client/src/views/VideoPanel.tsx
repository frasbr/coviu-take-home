import { useEffect, useRef } from "react";

export interface VideoPanelProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  error: string | null;
  localRole?: string;
  remoteRole?: string;
}

const VIDEO_WIDTH = 320;

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
    <div>
      {error && <p role="alert">{error}</p>}
      <div>
        {remoteRole && <span>{remoteRole}</span>}
        <video
          ref={remoteRef}
          aria-label="Remote video"
          autoPlay
          playsInline
          width={VIDEO_WIDTH}
        />
      </div>
      <div>
        {localRole && <span>{localRole}</span>}
        <video
          ref={localRef}
          aria-label="Local video"
          autoPlay
          playsInline
          muted
          width={VIDEO_WIDTH}
        />
      </div>
    </div>
  );
}
