// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CallScreenShell } from "./CallScreenShell.js";

afterEach(cleanup);

describe("CallScreenShell", () => {
  it("renders the video content and the bar content", () => {
    render(
      <CallScreenShell video={<span>video stage</span>} bar={<span>control bar</span>} />,
    );

    expect(screen.getByText("video stage")).toBeInTheDocument();
    expect(screen.getByText("control bar")).toBeInTheDocument();
  });

  it("places the bar after the video area in source order", () => {
    const { container } = render(
      <CallScreenShell video={<span>video stage</span>} bar={<span>control bar</span>} />,
    );

    const [videoArea, bar] = Array.from(container.firstChild!.childNodes);
    expect(videoArea.textContent).toBe("video stage");
    expect(bar.textContent).toBe("control bar");
  });

  it("fills exactly the viewport height and never scrolls", () => {
    const { container } = render(<CallScreenShell video={null} bar={null} />);

    expect(container.firstChild).toHaveClass("h-screen", "flex", "flex-col", "overflow-hidden");
  });

  it("gives the video area the remaining height and clips its own overflow", () => {
    const { container } = render(<CallScreenShell video={<span>video stage</span>} bar={null} />);

    const videoArea = container.firstChild!.firstChild as HTMLElement;
    expect(videoArea).toHaveClass("flex-1", "min-h-0", "overflow-hidden");
  });
});
