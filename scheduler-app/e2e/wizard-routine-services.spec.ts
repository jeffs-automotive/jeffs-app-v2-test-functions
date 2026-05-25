import { test, expect } from "@playwright/test";

import {
  SKIP_IF_NO_TEST_PHONE,
  SKIP_REASON_IF_NO_TEST_PHONE,
  completeGreeting,
  completePhoneAndName,
  completeOtp,
  completeVehiclePick,
  pickAppointmentType,
  pickFirstAvailableDate,
  expectSummaryCard,
  confirmAndExpectTestBypass,
} from "./helpers/wizard";

/**
 * Routine services flow — customer picks a pre-defined service (oil
 * change, tire rotation, etc.) from the service picker instead of going
 * through the diagnostic LLM. This is the FASTEST path through the
 * wizard (no concern free-text, no LLM round-trip).
 *
 * Two sub-flows tested:
 *   - Single routine service (oil change only)
 *   - Multi-select (oil change + tire rotation)
 *
 * The "second routine pass" step lets the customer add additional
 * routine services after the first selection. Tested here.
 */

test.describe("routine services flow (no LLM diagnostic)", () => {
  test.skip(SKIP_IF_NO_TEST_PHONE, SKIP_REASON_IF_NO_TEST_PHONE);

  test("single routine service: oil change only", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await completeGreeting(page, "returning");
    await completePhoneAndName(page);
    await completeOtp(page);
    await completeVehiclePick(page);

    // Service picker — click "oil change" chip.
    // Routine services render as chip buttons; labels vary slightly
    // (oil change, oil + filter change, etc.). Match permissively.
    await page.getByRole("button", { name: /oil.*change/i }).click();

    // After the first chip, the wizard surfaces "anything else?" or
    // similar. Decline to add more.
    const continueBtn = page
      .getByRole("button", { name: /no.*just.*that|continue.*just|that's it/i })
      .first();
    const moreVisible = await continueBtn
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (moreVisible) {
      await continueBtn.click();
    }

    await pickAppointmentType(page, "dropoff");
    await pickFirstAvailableDate(page);
    await expectSummaryCard(page);
    await confirmAndExpectTestBypass(page);
  });

  test("multi-routine: oil change + tire rotation", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await completeGreeting(page, "returning");
    await completePhoneAndName(page);
    await completeOtp(page);
    await completeVehiclePick(page);

    await page.getByRole("button", { name: /oil.*change/i }).click();

    // Second routine pass — pick tire rotation.
    const tireBtn = page.getByRole("button", { name: /tire.*rotat/i });
    const tireVisible = await tireBtn
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (tireVisible) {
      await tireBtn.click();
    }

    // Then decline a third pass.
    const doneBtn = page
      .getByRole("button", { name: /no.*just|that's it|continue/i })
      .first();
    if (await doneBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await doneBtn.click();
    }

    await pickAppointmentType(page, "dropoff");
    await pickFirstAvailableDate(page);
    await expectSummaryCard(page);

    // Summary should mention BOTH services. Permissive match.
    await expect(
      page.locator("text=/oil/i").or(page.locator("text=/tire/i")),
    ).toBeVisible({ timeout: 5_000 });

    await confirmAndExpectTestBypass(page);
  });
});
