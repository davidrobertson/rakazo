import { expect, type Route, test } from "@playwright/test";
import type { MessageBlock, ThreadMessage } from "@rakazo/contracts";
import { formatDurationMs } from "@rakazo/core";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

type ThreadSnapshot = {
  run?: { id: string; status: string } | null;
  messages: ThreadMessage[];
};

type PresentationMode = "completed" | "legacy" | "live";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "mobile-390x844", width: 390, height: 844 },
];

test("production chat renders persisted tool duration in every disclosure state", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
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

  const email = `tool-activity-shell-${Date.now()}@example.com`;
  await signup(page, email, "password123", "Tool Activity Shell");
  await completeOnboarding(page);
  const botId = activeBotId(page);

  const composer = page.getByPlaceholder(/Message/);
  await expect(composer).toBeEnabled();
  await composer.fill("Observe your screen and describe what you see.");
  const sent = page.waitForResponse(
    (response) => response.url().includes("/rpc/threads/send") && response.ok(),
  );
  await page.keyboard.press("Enter");
  const sentPayload = (await (await sent).json()) as { json: { runId: string } };
  const runId = sentPayload.json.runId;

  let persistedMessage: ThreadMessage | undefined;
  let persistedSteps: Extract<MessageBlock, { kind: "steps" }> | undefined;
  await expect
    .poll(
      async () => {
        const snapshot = await rpc<ThreadSnapshot>(page, "threads/get", { botId });
        persistedMessage = snapshot.messages.find(
          (message) =>
            message.runId === runId && message.blocks.some((block) => block.kind === "steps"),
        );
        persistedSteps = persistedMessage?.blocks.find(
          (block): block is Extract<MessageBlock, { kind: "steps" }> => block.kind === "steps",
        );
        return persistedSteps?.durationMs;
      },
      { timeout: 60_000 },
    )
    .toEqual(expect.any(Number));

  if (!persistedMessage || !persistedSteps || persistedSteps.durationMs === undefined) {
    throw new Error("completed run did not persist steps.durationMs");
  }
  const durableMessageId = persistedMessage.id;
  const duration = formatDurationMs(persistedSteps.durationMs);
  if (!duration) throw new Error("persisted duration did not format");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByPlaceholder(/Message/)).toBeVisible();

  let mode: PresentationMode = "completed";
  let nonNarration = false;
  const present = async (route: Route) => {
    await presentThreadMessage(route, runId, durableMessageId, mode, nonNarration);
  };
  await page.route("**/rpc/threads/get", present);
  await page.route("**/rpc/bootstrap", present);

  mode = "live";
  nonNarration = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  const liveMessage = page.locator(`[data-message-id="progress:${runId}"]`);
  const liveSummary = liveMessage.getByTestId("tool-activity").locator("summary");
  await expect(liveSummary).toHaveText("Working…");
  await liveSummary.focus();
  await page.keyboard.press("Enter");
  await expect(liveMessage.getByTestId("tool-activity")).toHaveAttribute("open", "");

  mode = "completed";
  await rpc(page, "threads/send", { botId, text: "Trigger reconciliation." });
  const completedMessage = page.locator(`[data-message-id="${durableMessageId}"]`);
  const remountedSummary = completedMessage.getByTestId("tool-activity").locator("summary");
  await expect(remountedSummary).toHaveText(`Worked for ${duration}`, { timeout: 60_000 });
  await expect(completedMessage.getByTestId("tool-activity")).not.toHaveAttribute("open", "");
  await expect(remountedSummary).toBeFocused();
  nonNarration = false;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    mode = "completed";
    await page.reload({ waitUntil: "domcontentloaded" });
    const completed = page.getByTestId("tool-activity").last();
    const completedSummary = completed.locator("summary");
    await expect(completedSummary).toHaveText(`Worked for ${duration}`);
    await expect(completed).not.toHaveAttribute("open", "");
    await captureScreenshot(page, testInfo, `shell-completed-collapsed-${viewport.name}`);
    await completedSummary.focus();
    await page.keyboard.press("Enter");
    await expect(completed).toHaveAttribute("open", "");
    await expect(completedSummary).toBeFocused();
    await captureScreenshot(page, testInfo, `shell-completed-expanded-${viewport.name}`);

    mode = "live";
    await page.reload({ waitUntil: "domcontentloaded" });
    const live = page.getByTestId("tool-activity").last();
    await expect(live.locator("summary")).toHaveText("Working…");
    await expect(live).not.toHaveAttribute("open", "");
    await captureScreenshot(page, testInfo, `shell-live-collapsed-${viewport.name}`);
    await live.locator("summary").click();
    await expect(live).toHaveAttribute("open", "");

    mode = "legacy";
    await page.reload({ waitUntil: "domcontentloaded" });
    const legacy = page.getByTestId("tool-activity").last();
    await expect(legacy.locator("summary")).toHaveText("Worked");
    await expect(legacy).not.toHaveAttribute("open", "");
    await legacy.locator("summary").click();
    await expect(legacy).toHaveAttribute("open", "");
  }

  mode = "completed";
  await page.evaluate(() => localStorage.setItem("rakazo.uiLocale", "de"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("tool-activity").last().locator("summary")).toHaveText(
    `${duration} lang gearbeitet`,
  );

  expect(browserErrors).toEqual([]);
});

async function presentThreadMessage(
  route: Route,
  runId: string,
  durableMessageId: string,
  mode: PresentationMode,
  nonNarration: boolean,
) {
  const response = await route.fetch();
  const payload = (await response.json()) as unknown;
  mutatePresentation(payload, runId, durableMessageId, mode, nonNarration);
  await route.fulfill({ response, json: payload });
}

function mutatePresentation(
  value: unknown,
  runId: string,
  durableMessageId: string,
  mode: PresentationMode,
  nonNarration: boolean,
) {
  if (Array.isArray(value)) {
    for (const child of value) {
      mutatePresentation(child, runId, durableMessageId, mode, nonNarration);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (
    record.runId === runId &&
    Array.isArray(record.blocks) &&
    record.blocks.some(
      (block) =>
        block && typeof block === "object" && (block as { kind?: string }).kind === "steps",
    )
  ) {
    record.id = mode === "live" ? `progress:${runId}` : durableMessageId;
    if (nonNarration) {
      record.blocks.unshift({ kind: "meta", text: "Tool activity" });
    }
    if (mode === "legacy") {
      for (const block of record.blocks) {
        if (block && typeof block === "object" && (block as { kind?: string }).kind === "steps") {
          delete (block as { durationMs?: number }).durationMs;
        }
      }
    }
  }
  for (const child of Object.values(record)) {
    mutatePresentation(child, runId, durableMessageId, mode, nonNarration);
  }
}
