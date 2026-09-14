// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VideoPanel } from "./VideoPanel.js";

function createStream() {
  return { getTracks: () => [] } as unknown as MediaStream;
}

function video(label: string) {
  return screen.getByLabelText(label) as HTMLVideoElement;
}

afterEach(cleanup);

describe("VideoPanel", () => {
  it("labels each video feed with its role", () => {
    render(
      <VideoPanel
        localStream={null}
        remoteStream={null}
        error={null}
        localRole="Patient"
        remoteRole="Provider"
      />,
    );

    expect(screen.getByText("Patient")).toBeInTheDocument();
    expect(screen.getByText("Provider")).toBeInTheDocument();
  });

  it("mutes the local video and leaves the remote video unmuted", () => {
    render(<VideoPanel localStream={null} remoteStream={null} error={null} />);

    expect(video("Local video").muted).toBe(true);
    expect(video("Remote video").muted).toBe(false);
  });

  it("assigns each stream to the matching element's srcObject", () => {
    const localStream = createStream();
    const remoteStream = createStream();

    render(<VideoPanel localStream={localStream} remoteStream={remoteStream} error={null} />);

    expect(video("Local video").srcObject).toBe(localStream);
    expect(video("Remote video").srcObject).toBe(remoteStream);
  });

  it("clears srcObject when a stream prop goes back to null", () => {
    const remoteStream = createStream();
    const { rerender } = render(
      <VideoPanel localStream={null} remoteStream={remoteStream} error={null} />,
    );
    expect(video("Remote video").srcObject).toBe(remoteStream);

    rerender(<VideoPanel localStream={null} remoteStream={null} error={null} />);

    expect(video("Remote video").srcObject).toBeNull();
  });

  it("renders a non-null error as an alert", () => {
    render(
      <VideoPanel
        localStream={null}
        remoteStream={null}
        error="Could not access the camera or microphone."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not access the camera or microphone.",
    );
  });

  it("renders no alert when the error is null", () => {
    render(<VideoPanel localStream={null} remoteStream={null} error={null} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a placeholder reason on the remote tile when remoteStream is null", () => {
    const localStream = createStream();
    render(
      <VideoPanel
        localStream={localStream}
        remoteStream={null}
        error={null}
        remoteRole="Provider"
      />,
    );

    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the other side to join")).toBeInTheDocument();

    const remoteVideo = video("Remote video");
    expect(remoteVideo).toBeInTheDocument();
    expect(remoteVideo.srcObject).toBeNull();
  });

  it("shows a placeholder reason on the local tile when localStream is null", () => {
    const remoteStream = createStream();
    render(<VideoPanel localStream={null} remoteStream={remoteStream} error={null} />);

    expect(screen.getByText("Waiting for the camera")).toBeInTheDocument();

    const localVideo = video("Local video");
    expect(localVideo).toBeInTheDocument();
    expect(localVideo.srcObject).toBeNull();
    expect(localVideo.muted).toBe(true);
  });

  it("shows both placeholder reasons when both streams are null", () => {
    render(<VideoPanel localStream={null} remoteStream={null} error={null} />);

    expect(screen.getByText("Waiting for the other side to join")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the camera")).toBeInTheDocument();
  });

  it("shows no placeholder reasons when both streams are set", () => {
    const localStream = createStream();
    const remoteStream = createStream();
    render(<VideoPanel localStream={localStream} remoteStream={remoteStream} error={null} />);

    expect(screen.queryByText("Waiting for the other side to join")).not.toBeInTheDocument();
    expect(screen.queryByText("Waiting for the camera")).not.toBeInTheDocument();
  });
});
