import { test, expect } from "@playwright/test";

/**
 * PLAN-01 Phase 4D — wizard happy-path E2E.
 *
 * Exercises the full "returning customer with one vehicle → testing-service
 * recommendation → confirmation" flow. Gated on the existing test-OTP
 * bypass (`SCHEDULER_TEST_PHONE_E164` + `SCHEDULER_TEST_OTP_CODE` env
 * vars set on the Supabase project — see
 * `supabase/functions/_shared/tools/scheduler-otp.ts` line 285+).
 *
 * Skip conditions:
 * - `SKIP_PLAYWRIGHT_E2E=1` — explicit opt-out
 * - `PLAYWRIGHT_TEST_PHONE_E164` env var missing — no test phone available
 *
 * Phone + code must match what the Supabase project's edge functions are
 * configured for. The phone here is the LOCAL-test value (which the spec
 * uses to type into the form); the actual bypass is keyed on the same
 * value being set in the Supabase project's secrets.
 */

const TEST_PHONE = process.env.PLAYWRIGHT_TEST_PHONE_E164 ?? "";
const TEST_OTP_CODE = process.env.PLAYWRIGHT_TEST_OTP_CODE ?? "999999";

const SKIP = !TEST_PHONE || process.env.SKIP_PLAYWRIGHT_E2E === "1";

test.describe("wizard happy-path", () => {
  test.skip(
    SKIP,
    "PLAYWRIGHT_TEST_PHONE_E164 not set (or SKIP_PLAYWRIGHT_E2E=1). " +
      "See e2e/README.md for setup.",
  );

  test("returning customer books a brake_inspection", async ({ page }) => {
    test.setTimeout(180_000); // Wizard end-to-end can take 60-120s.

    await page.goto("/book-v2", { waitUntil: "domcontentloaded" });

    // ─── Step 1 — Greeting ───────────────────────────────────────────────
    await expect(
      page.getByRole("heading", { name: /Hi, I'?m\s+\w+/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole("button", { name: /Yes.*returning customer/i })
      .click();

    // ─── Step 2 — Phone + name ────────────────────────────────────────────
    // GreetingCard → backend may route to PhoneNameCard (returning customer
    // path). Field labels are RHF-controlled; query by accessible name.
    await page
      .getByRole("textbox", { name: /phone/i })
      .fill(formatPhoneForInput(TEST_PHONE));
    await page.getByRole("button", { name: /(continue|next|verify)/i }).click();

    // ─── Step 3 — OTP ─────────────────────────────────────────────────────
    // OtpInput is 6 individual input boxes; type one digit per box.
    await fillOtp(page, TEST_OTP_CODE);
    // OtpInput auto-submits when the 6th digit is filled. If a manual
    // Verify button exists, this click is a defensive no-op.
    await page
      .getByRole("button", { name: /verify/i })
      .click({ trial: true })
      .catch(() => undefined);

    // ─── Step 4 — Vehicle pick (multi-vehicle customers) ──────────────────
    // For a returning customer, the wizard may auto-advance if there's only
    // one vehicle on file. For multi-vehicle, pick the first option.
    const vehicleCard = page.getByRole("heading", { name: /vehicle/i });
    if (await vehicleCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page.locator('[role="radio"]').first().click();
      await page.getByRole("button", { name: /continue/i }).click();
    }

    // ─── Step 5 — Service + concern picker ────────────────────────────────
    // Service picker has multiple choice tiles. Pick "Other Issue" to
    // route through the diagnostic LLM (the load-bearing path).
    await page.getByRole("button", { name: /other.*issue/i }).click();

    // Free-form concern text. Type a brake-related concern so the LLM
    // routes to brake_inspection deterministically.
    await page
      .getByRole("textbox", { name: /describe.*concern|tell.*about/i })
      .fill("my brakes are squealing when I come to a stop");
    await page.getByRole("button", { name: /continue/i }).click();

    // ─── Step 6 — Diagnostic LLM (8-30s) ──────────────────────────────────
    // The wizard shows a loading state while diagnose-concern runs.
    // Wait for the testing service recommendation to surface.
    await expect(
      page.getByText(/brake.*inspection|brake.*test/i),
    ).toBeVisible({ timeout: 60_000 });

    // ─── Step 7 — Approve recommendation ──────────────────────────────────
    await page.getByRole("button", { name: /(accept|approve|continue)/i }).click();

    // ─── Step 8 — Confirmation lands ──────────────────────────────────────
    // SummaryCard or post-confirm card; just verify we got there.
    await expect(
      page.getByText(/(you're booked|confirmed|appointment booked)/i),
    ).toBeVisible({ timeout: 30_000 });
  });
});

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Strip "+1" from E.164 phone to match the wizard's tel-input format.
 * The wizard accepts loose input (US phone with or without country code).
 */
function formatPhoneForInput(e164: string): string {
  return e164.replace(/^\+1/, "");
}

/**
 * OtpInput renders 6 separate `<input>` elements. Type one digit per box,
 * relying on focus auto-advance OR explicit Tab fallback.
 */
async function fillOtp(page: import("@playwright/test").Page, code: string) {
  // OTP inputs typically have aria-label="Code digit 1" etc. or just inputmode="numeric".
  // Try aria-label match first; fall back to a positional locator.
  const otpInputs = page.locator(
    'input[inputmode="numeric"], input[autocomplete="one-time-code"]',
  );
  const count = await otpInputs.count();
  if (count >= 6) {
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(code[i] ?? "");
    }
    return;
  }
  // Single combined input fallback.
  const combined = page.getByRole("textbox", { name: /(code|verification)/i });
  await combined.fill(code);
}
