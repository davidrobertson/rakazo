import { i18n } from "@lingui/core";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { MessageHoverMetadata } from "./MessageHoverMetadata";

describe("MessageHoverMetadata", () => {
  afterEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
  });

  it("shows the message's creation time beside its actions below the message", () => {
    i18n.load("en", {});
    i18n.activate("en");

    const createdAt = new Date(2026, 7, 21, 18, 14).toISOString();
    const html = renderToStaticMarkup(
      <MessageHoverMetadata align="end" createdAt={createdAt}>
        <div data-testid="message-actions-pill" />
      </MessageHoverMetadata>,
    );

    expect(html).toContain(
      `<time dateTime="${createdAt}" class="text-[11px] tabular-nums text-[#85858A]">6:14 PM</time>`,
    );
    expect(html.indexOf("<time")).toBeLessThan(html.indexOf('data-testid="message-actions-pill"'));
    expect(html).toContain("group-hover/message:opacity-100");
    expect(html).toContain("focus-within:opacity-100");
    expect(html).toContain("bottom-0");
    expect(html).toContain("end-0");
    expect(html).not.toContain("top-0");
  });

  it("aligns bot metadata with the start of the message", () => {
    i18n.load("en", {});
    i18n.activate("en");

    const html = renderToStaticMarkup(
      <MessageHoverMetadata align="start" createdAt={new Date().toISOString()}>
        <div data-testid="message-actions-pill" />
      </MessageHoverMetadata>,
    );

    expect(html).toContain("start-0");
    expect(html).not.toContain("end-0");
  });

  it("formats the displayed time with the active i18n locale", () => {
    i18n.load("de", {});
    i18n.activate("de");

    const createdAt = new Date(2026, 7, 21, 18, 14).toISOString();
    const html = renderToStaticMarkup(
      <MessageHoverMetadata align="end" createdAt={createdAt}>
        <div data-testid="message-actions-pill" />
      </MessageHoverMetadata>,
    );

    expect(html).toContain(`dateTime="${createdAt}"`);
    expect(html).toContain(">18:14</time>");
    expect(html).not.toContain("6:14 PM");
  });
});
