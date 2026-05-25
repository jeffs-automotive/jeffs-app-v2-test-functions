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
 * Wizard happy-path E2E — returning customer, brake_inspection
 * recommendation, confirmation via test-bypass.
 *
 * 2026-05-25 update: Tekmetric POST bypass added to `submit-summary.ts`
 * (see comment block there). When SCHEDULER_TEST_PHONE_E164 matches the
 * session row's phone, confirmBooking is skipped + a synthetic
 * `appointment_confirmed_at = now()` is written + a 🧪 [TEST MODE]
 * bubble surfaces. No real Tekmetric appointment is created.
 *
 * Both bypasses (OTP-send + Tekmetric-POST) are env-gated by the same
 * SCHEDULER_TEST_PHONE_E164 value — set it on:
 *   - Supabase project secrets (Edge Functions → Secrets)
 *   - Vercel project env vars (Production + Preview)
 *
 * Skip conditions documented in helpers/wizard.ts.
 */

test.describe("wizard happy-path (returning customer + brake LLM recommendation)", () => {
  test.skip(SKIP_IF_NO_TEST_PHONE, SKIP_REASON_IF_NO_TEST_PHONE);

  test("returning customer books a brake_inspection (Tekmetric POST bypassed)", async ({
    page,
  }) => {
    test.setTimeout(180_000); // wizard end-to-end can take 60-120s

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await completeGreeting(page, "returning");
    await completePhoneAndName(page);
    await completeOtp(page);
    await completeVehiclePick(page);

    // Service + concern picker — "Other Issue" routes through the
    // diagnostic LLM (load-bearing path). The free-form text deterministically
    // routes to brake_inspection per the LLM's concern→service mapping.
    await page.getByRole("button", { name: /other.*issue/i }).click();
    await page
      .getByRole("textbox", { name: /describe.*concern|tell.*about/i })
      .fill("my brakes are squealing when I come to a stop");
    await page.getByRole("button", { name: /continue/i }).click();

    // Diagnostic LLM (8-30s normally; 60s budget for cold starts).
    await expect(
      page.getByText(/brake.*inspection|brake.*test/i),
    ).toBeVisible({ timeout: 60_000 });
    await page
      .getByRole("button", { name: /(accept|approve|continue)/i })
      .click();

    await pickAppointmentType(page, "dropoff");
    await pickFirstAvailableDate(page);
    await expectSummaryCard(page);
    await confirmAndExpectTestBypass(page);
  });
});
