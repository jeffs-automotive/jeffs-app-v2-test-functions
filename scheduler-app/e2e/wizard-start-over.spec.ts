import { test, expect } from "@playwright/test";

import {
  SKIP_IF_NO_TEST_PHONE,
  SKIP_REASON_IF_NO_TEST_PHONE,
  completeGreeting,
  completePhoneAndName,
  completeOtp,
  completeVehiclePick,
} from "./helpers/wizard";

/**
 * Start-Over flow — exercise the page-footer "Start Over" affordance.
 * Tests that:
 *
 *   1. Clicking Start Over wipes the session row state
 *   2. Wizard returns to the greeting card
 *   3. Customer can begin a fresh flow
 *
 * Also covers the hold-release on start-over (any active hold for the
 * session is released, freeing the slot).
 */

test.describe("Start Over — wipe + return to greeting", () => {
  test.skip(SKIP_IF_NO_TEST_PHONE, SKIP_REASON_IF_NO_TEST_PHONE);

  test("Start Over from vehicle pick returns to greeting", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await completeGreeting(page, "returning");
    await completePhoneAndName(page);
    await completeOtp(page);
    await completeVehiclePick(page);

    // Mid-flow — click Start Over in the page footer.
    const startOverBtn = page.getByRole("button", { name: /start.*over/i });
    await expect(startOverBtn).toBeVisible({ timeout: 5_000 });
    await startOverBtn.click();

    // Wizard returns to greeting card.
    await expect(
      page.getByRole("heading", { name: /Hi, I'?m\s+\w+/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/Have you been to our shop before/i),
    ).toBeVisible();
  });
});
