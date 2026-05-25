import { test, expect } from "@playwright/test";

import {
  SKIP_IF_NO_TEST_PHONE,
  SKIP_REASON_IF_NO_TEST_PHONE,
  progressToSummary,
  pickFirstAvailableDate,
  pickAppointmentType,
  expectSummaryCard,
  confirmAndExpectTestBypass,
} from "./helpers/wizard";

/**
 * Summary-card edit paths — customer reaches summary, then chooses to
 * edit something (date / vehicle / services / customer info) and
 * returns to summary. Up to 2 edits allowed per chat-design.md §10.1.5;
 * the 3rd attempt escalates.
 *
 * Each edit-bounce takes ~5-15s. We test the most common: edit date.
 */

test.describe("summary card — edit paths", () => {
  test.skip(SKIP_IF_NO_TEST_PHONE, SKIP_REASON_IF_NO_TEST_PHONE);

  test("edit date from summary → bounces to date_pick → returns to summary", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await progressToSummary(page);

    // SummaryCard renders per-section edit affordances. The date edit
    // is typically a pencil icon or a "change date" button near the
    // appointment date row.
    const editDateBtn = page
      .getByRole("button", { name: /(edit|change).*date/i })
      .first();
    const editVisible = await editDateBtn
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (editVisible) {
      await editDateBtn.click();

      // Wizard bounces back to date_pick.
      await expect(
        page.getByRole("heading", { name: /pick.*date|choose.*date/i }),
      ).toBeVisible({ timeout: 15_000 });

      // Pick a different date (the picker's first available — could be
      // the same date, but the click DOES exercise the submit-date
      // path again).
      await pickFirstAvailableDate(page);

      // For dropoff path, we go straight back to summary. For waiter,
      // waiter_time_pick first.
      await pickAppointmentType(page, "dropoff");
      await expectSummaryCard(page);
      await confirmAndExpectTestBypass(page);
    } else {
      // If the card doesn't expose an "edit date" affordance, the
      // wizard's design has shifted — fail loudly so we update the
      // selector.
      throw new Error(
        "SummaryCard doesn't expose an 'edit date' button — selector drift.",
      );
    }
  });

  test("confirm directly from summary (no edits) → customer_notes", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await progressToSummary(page);
    await confirmAndExpectTestBypass(page);
  });
});
