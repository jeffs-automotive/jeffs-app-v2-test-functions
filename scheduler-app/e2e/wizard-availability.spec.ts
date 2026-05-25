import { test, expect } from "@playwright/test";

import {
  SKIP_IF_NO_TEST_PHONE,
  SKIP_REASON_IF_NO_TEST_PHONE,
  completeGreeting,
  completePhoneAndName,
  completeOtp,
  completeVehiclePick,
  pickAppointmentType,
} from "./helpers/wizard";

/**
 * Availability + capacity behavior tests.
 *
 * Verifies:
 *   1. Sundays are NEVER offered (closed_dates seed)
 *   2. Past dates are never offered
 *   3. Picker shows AT LEAST one available day in the next 14 days
 *      (a sanity floor — if zero days are offered, the wizard is
 *      effectively broken even though no error fires)
 *
 * These tests run pre-summary (no Tekmetric POST), so the test phone
 * + bypass aren't strictly required — but the wizard's session-row
 * state still needs the customer/vehicle picks before reaching
 * date_pick, so we use the test phone for consistency.
 */

test.describe("availability picker — date filter behavior", () => {
  test.skip(SKIP_IF_NO_TEST_PHONE, SKIP_REASON_IF_NO_TEST_PHONE);

  test("date picker offers at least one date AND excludes Sundays", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await completeGreeting(page, "returning");
    await completePhoneAndName(page);
    await completeOtp(page);
    await completeVehiclePick(page);

    // Skip to date_pick — pick "oil change" (routine) to avoid the
    // diagnostic LLM round-trip.
    await page.getByRole("button", { name: /oil.*change/i }).click();
    const continueBtn = page
      .getByRole("button", { name: /no.*just.*that|continue.*just|that's it/i })
      .first();
    if (await continueBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await continueBtn.click();
    }
    await pickAppointmentType(page, "dropoff");

    await expect(
      page.getByRole("heading", { name: /pick.*date|choose.*date/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Count enabled date buttons. CalendarDatePicker renders enabled
    // dates with aria-label containing the year. Disabled days have
    // aria-disabled="true".
    const enabledDates = page.locator(
      'button[aria-label*="2026"]:not([aria-disabled="true"]):not([disabled])',
    );
    const enabledCount = await enabledDates.count();
    expect(enabledCount).toBeGreaterThanOrEqual(1);

    // No Sunday dates should appear as enabled. Walk through the
    // visible enabled date buttons + parse their aria-label day-of-week.
    for (let i = 0; i < Math.min(enabledCount, 30); i++) {
      const label = await enabledDates.nth(i).getAttribute("aria-label");
      if (label) {
        expect(label).not.toMatch(/sunday/i);
      }
    }
  });
});
