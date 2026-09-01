import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("a failed run is visible once without returning after reload", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `run-failure-${stamp}@rakazo.test`, "password12", "Run Failure");
  await completeOnboarding(page);

  // "fail this run" makes the scripted runtime throw, so the run fails the same way a
  // real provider error would, without depending on how models are configured.
  await page.getByPlaceholder(/^Message /).fill("fail this run");
  await page.getByRole("button", { name: "Send" }).click();

  const error = page.getByTestId("composer-error");
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error).not.toBeEmpty();
  await captureScreenshot(page, testInfo, "new-run-error-visible");

  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await expect(
    page.getByTestId("transcript").getByText("fail this run", { exact: true }),
  ).toBeVisible();
  await expect(error).toBeHidden();
  await captureScreenshot(page, testInfo, "seen-run-error-hidden-after-reload");

  await page.getByPlaceholder(/^Message /).fill("fail this run");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(error).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("composer-error-dismiss").click();
  await expect(error).toBeHidden();
});

test("a covered run error is not remembered until it is presented", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `covered-run-failure-${stamp}@rakazo.test`, "password12", "Covered Failure");
  await completeOnboarding(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByPlaceholder(/^Message /).fill("fail this run");
  const sendButton = await page.getByRole("button", { name: "Send" }).elementHandle();
  if (!sendButton) throw new Error("Send button not found");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("main")).toHaveJSProperty("inert", true);
  await sendButton.evaluate((button) => (button as HTMLButtonElement).click());

  const error = page.getByTestId("composer-error");
  await expect(error).not.toBeEmpty({ timeout: 30_000 });
  await captureScreenshot(page, testInfo, "run-error-covered-by-mobile-navigation");
  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await expect(error).toBeVisible();
  await captureScreenshot(page, testInfo, "covered-run-error-presented-after-reload");

  await page.reload();
  await expect(page.getByTestId("shell-root")).toHaveAttribute("data-ready", "true");
  await expect(error).toBeHidden();
});
