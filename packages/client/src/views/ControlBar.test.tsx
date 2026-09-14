// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ControlBar } from "./ControlBar.js";

afterEach(cleanup);

describe("ControlBar", () => {
  it("renders arbitrary status content", () => {
    render(<ControlBar status={<p>State: ACTIVE</p>} actions={null} />);

    expect(screen.getByText("State: ACTIVE")).toBeInTheDocument();
  });

  it("renders arbitrary action content", () => {
    render(
      <ControlBar
        status={null}
        actions={
          <button type="button" onClick={() => {}}>
            End session
          </button>
        }
      />,
    );

    expect(screen.getByRole("button", { name: "End session" })).toBeInTheDocument();
  });

  it("renders multiple actions in the order given", () => {
    render(
      <ControlBar
        status={null}
        actions={
          <>
            <button type="button">Admit patient</button>
            <button type="button">End session</button>
          </>
        }
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Admit patient", "End session"]);
  });

  it("spans the full width and never shrinks inside its flex parent", () => {
    const { container } = render(<ControlBar status={null} actions={null} />);

    expect(container.firstChild).toHaveClass("w-full", "shrink-0");
  });
});
