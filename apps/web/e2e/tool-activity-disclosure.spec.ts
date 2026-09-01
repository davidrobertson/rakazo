import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "mobile-390x844", width: 390, height: 844 },
];
const states = [
  { name: "active", live: true, label: "Working…" },
  { name: "complete", live: false, label: "Worked for 1m 43s" },
];

test("tool activity stays collapsed until disclosed", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
  page.on("requestfailed", (request) =>
    browserErrors.push(
      `network: ${request.method()} ${request.url()} ${request.failure()?.errorText}`,
    ),
  );

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const state of states) {
      await page.goto(`/e2e/fixtures/tool-activity-disclosure.html?live=${state.live ? 1 : 0}`);
      const details = page.getByTestId("tool-activity");
      const summary = details.locator("summary");
      const rows = page.getByTestId("tool-rows");

      await expect(summary).toHaveText(state.label);
      const summaryBox = await summary.boundingBox();
      expect(summaryBox?.height).toBeGreaterThanOrEqual(24);
      expect(summaryBox?.width).toBeGreaterThanOrEqual(24);
      await expect(details).not.toHaveAttribute("open", "");
      await expect(rows).not.toBeVisible();
      await expect(page.getByTestId("final-response")).toHaveCount(state.live ? 0 : 1);
      await captureScreenshot(page, testInfo, `${state.name}-collapsed-${viewport.name}`);

      await summary.click();
      await expect(details).toHaveAttribute("open", "");
      await summary.click();
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(details).toHaveAttribute("open", "");
      await expect(rows).toBeVisible();
      await expect(summary).toBeFocused();
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", viewport.width);
      if (!state.live) {
        const rowBox = await rows.boundingBox();
        const responseBox = await page.getByTestId("final-response").boundingBox();
        expect(rowBox).not.toBeNull();
        expect(responseBox).not.toBeNull();
        expect(responseBox?.y).toBeGreaterThan((rowBox?.y ?? 0) + (rowBox?.height ?? 0));
      }
      await captureScreenshot(page, testInfo, `${state.name}-expanded-${viewport.name}`);
    }
  }

  await page.goto("/e2e/fixtures/tool-activity-disclosure.html?live=1");
  const details = page.getByTestId("tool-activity");
  const summary = details.locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await page.evaluate(() =>
    (window as unknown as { renderToolActivity: (live: boolean) => void }).renderToolActivity(
      false,
    ),
  );
  await expect(details).not.toHaveAttribute("open", "");
  await expect(summary).toHaveText("Worked for 1m 43s");
  await expect(summary).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/fixtures/tool-activity-disclosure.html?live=1");
  await page.getByTestId("tool-activity").locator("summary").click();
  const activeIcon = page.getByTestId("tool-rows").getByText("◷");
  await expect(activeIcon).toBeVisible();
  expect(await activeIcon.evaluate((icon) => getComputedStyle(icon).animationName)).toBe("none");

  expect(browserErrors).toEqual([]);
});
