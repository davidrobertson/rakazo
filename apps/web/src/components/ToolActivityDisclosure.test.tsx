// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolActivityDisclosure, ToolSteps } from "./ToolActivityDisclosure";

describe("ToolActivityDisclosure", () => {
  it("gives tool rows localized state names without exposing status glyphs", () => {
    const html = renderToStaticMarkup(
      <ToolSteps
        steps={[{ label: "Shell", count: 1 }]}
        currentIndex={0}
        completedLabel="Completed"
        inProgressLabel="In progress"
      />,
    );
    expect(html).toContain("In progress: ");
    expect(html).toContain('aria-hidden="true"');
  });
  it.each([
    [true, "Working…"],
    [false, "Worked for 1m 43s"],
    [false, "Worked"],
  ])("defaults collapsed with the %s state label", (live, label) => {
    const html = renderToStaticMarkup(
      <ToolActivityDisclosure live={live} label={label}>
        <span>Shell ×2</span>
      </ToolActivityDisclosure>,
    );

    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain(`<summary`);
    expect(html).toContain(label);
    expect(html).toContain("Shell ×2");
  });

  it("collapses again when live work completes", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (live: boolean) =>
      flushSync(() =>
        root.render(
          <ToolActivityDisclosure live={live} label={live ? "Working…" : "Worked for 1m 43s"}>
            <span>Shell ×2</span>
          </ToolActivityDisclosure>,
        ),
      );

    render(true);
    const summary = container.querySelector("summary");
    summary?.focus();
    summary?.click();
    expect(container.querySelector("details")?.open).toBe(true);
    expect(document.activeElement).toBe(summary);

    render(false);
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.querySelector("summary")?.textContent).toContain("Worked for 1m 43s");
    expect(document.activeElement).toBe(summary);
    root.unmount();
    container.remove();
  });

  it("restores summary focus when completion remounts the message", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const render = (key: string, live: boolean) =>
      flushSync(() =>
        root.render(
          <ToolActivityDisclosure
            key={key}
            focusKey="run-1:0"
            live={live}
            label={live ? "Working…" : "Worked for 1m 43s"}
          >
            <span>Shell ×2</span>
          </ToolActivityDisclosure>,
        ),
      );

    render("progress:run-1", true);
    const liveSummary = container.querySelector("summary");
    liveSummary?.focus();
    liveSummary?.click();

    render("message-1", false);
    const completedSummary = container.querySelector("summary");
    expect(completedSummary).not.toBe(liveSummary);
    expect(container.querySelector("details")?.open).toBe(false);
    expect(document.activeElement).toBe(completedSummary);
    root.unmount();
    container.remove();
  });
});
