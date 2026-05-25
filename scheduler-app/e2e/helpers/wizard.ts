/**
 * Shared Playwright helpers for the scheduler wizard E2E suite.
 *
 * 2026-05-25 — extracted from `wizard-happy-path.spec.ts` so multiple
 * specs can compose the wizard's stages without duplicating selectors.
 *
 * All helpers assume the wizard's `/`, `/book`, or `/book-v2` route is
 * already navigated to. The test runner uses `force-dynamic` so each
 * test gets a fresh customer_chat_sessions row by visiting with a new
 * cookie (Playwright's `browserContext.newPage()` per test).
 *
 * OTP + Tekmetric bypasses both fire only when SCHEDULER_TEST_PHONE_E164
 * env var is set on the relevant runtime:
 *   - Supabase project (edge fns) — bypasses Telnyx OTP send
 *   - Vercel project (Server Actions) — bypasses Tekmetric POST at
 *     summary-confirm time
 * See e2e/README.md for the full operator setup.
 */
import { expect, type Page } from "@playwright/test";

export const TEST_PHONE = process.env.PLAYWRIGHT_TEST_PHONE_E164 ?? "";
export const TEST_OTP_CODE = process.env.PLAYWRIGHT_TEST_OTP_CODE ?? "999999";

/**
 * Strip "+1" from E.164 phone to match the wizard's tel-input format.
 * The wizard accepts loose input (US phone with or without country code).
 */
export function formatPhoneForInput(e164: string): string {
  return e164.replace(/^\+1/, "");
}

/**
 * OtpInput renders 6 separate `<input>` elements. Type one digit per box,
 * relying on focus auto-advance OR explicit Tab fallback.
 */
export async function fillOtp(page: Page, code: string): Promise<void> {
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
  const combined = page.getByRole("textbox", { name: /(code|verification)/i });
  await combined.fill(code);
}

/**
 * Step 1 — Greeting: pick "returning customer" path.
 */
export async function completeGreeting(
  page: Page,
  variant: "returning" | "new" | "info_only" = "returning",
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /Hi, I'?m\s+\w+/i }),
  ).toBeVisible({ timeout: 30_000 });
  const buttonName =
    variant === "returning"
      ? /Yes.*returning customer/i
      : variant === "new"
        ? /No.*first time|new customer/i
        : /just have a question|info only/i;
  await page.getByRole("button", { name: buttonName }).click();
}

/**
 * Step 2 — Phone + name (returning-customer path). Uses TEST_PHONE.
 */
export async function completePhoneAndName(page: Page): Promise<void> {
  await page
    .getByRole("textbox", { name: /phone/i })
    .fill(formatPhoneForInput(TEST_PHONE));
  await page
    .getByRole("button", { name: /(continue|next|verify)/i })
    .click();
}

/**
 * Step 3 — OTP. Static code from TEST_OTP_CODE; OtpInput auto-submits.
 */
export async function completeOtp(page: Page): Promise<void> {
  await fillOtp(page, TEST_OTP_CODE);
  await page
    .getByRole("button", { name: /verify/i })
    .click({ trial: true })
    .catch(() => undefined);
}

/**
 * Step 4 — Vehicle pick. Auto-advances for single-vehicle customers;
 * picks first option for multi-vehicle. Tolerant of either shape.
 */
export async function completeVehiclePick(page: Page): Promise<void> {
  const vehicleCard = page.getByRole("heading", { name: /vehicle/i });
  const visible = await vehicleCard
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  if (visible) {
    await page.locator('[role="radio"]').first().click();
    await page.getByRole("button", { name: /continue/i }).click();
  }
}

/**
 * Step 5a — Appointment type pick (waiter vs dropoff). The card may or
 * may not appear depending on the service mix; tolerant.
 */
export async function pickAppointmentType(
  page: Page,
  type: "waiter" | "dropoff",
): Promise<void> {
  const apptCard = page.getByRole("heading", {
    name: /how would you like|appointment type|waiter or drop/i,
  });
  const visible = await apptCard
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  if (visible) {
    const buttonName =
      type === "waiter" ? /wait at the shop|waiter/i : /drop.*off/i;
    await page.getByRole("button", { name: buttonName }).click();
  }
}

/**
 * Step 6 — Date pick. Picks the FIRST available date in the calendar.
 * Per the post-audit fix (commit 5aee725), availability now correctly
 * filters days that are at or over capacity, so the first available
 * date should be genuinely bookable.
 */
export async function pickFirstAvailableDate(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /pick.*date|choose.*date/i }),
  ).toBeVisible({ timeout: 30_000 });
  // CalendarDatePicker renders enabled date buttons with role="button"
  // and aria-label like "Monday, May 25, 2026". Disabled days have
  // aria-disabled="true". Pick the first enabled future-date button.
  const firstEnabled = page
    .locator(
      'button[aria-label*="2026"]:not([aria-disabled="true"]):not([disabled])',
    )
    .first();
  await firstEnabled.click();
}

/**
 * Step 7 — Waiter time pick (only fires on waiter path).
 */
export async function pickFirstAvailableWaiterTime(page: Page): Promise<void> {
  const timeCard = page.getByRole("heading", {
    name: /pick.*time|what time/i,
  });
  const visible = await timeCard
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
  if (visible) {
    // Two buttons: 8:00 AM + 9:00 AM. Pick whichever is enabled.
    const enabled = page
      .locator('button:not([disabled]):has-text("AM")')
      .first();
    await enabled.click();
  }
}

/**
 * Step 8 — Summary card lands.
 */
export async function expectSummaryCard(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", {
      name: /(review|summary|here's what we have|appointment details)/i,
    }),
  ).toBeVisible({ timeout: 60_000 });
}

/**
 * Step 9 — Confirm + verify Tekmetric bypass landed at customer_notes.
 * Requires `SCHEDULER_TEST_PHONE_E164` set on the Vercel deployment
 * (matches Supabase OTP bypass + adds the Tekmetric POST skip).
 */
export async function confirmAndExpectTestBypass(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /(confirm|book|yes.*looks good)/i })
    .click();
  // Tekmetric bypass synthesizes a "confirmed" state and advances to
  // customer_notes with the 🧪 test-mode marker bubble.
  await expect(page.getByText(/test mode/i)).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(/anything special.*let our techs know/i),
  ).toBeVisible({ timeout: 5_000 });
}

/**
 * Convenience composer for the most common path: greeting → phone → OTP
 * → vehicle → date → summary. Stops just BEFORE confirm so the caller
 * can branch (confirm vs edit).
 */
export async function progressToSummary(
  page: Page,
  opts: { concern?: string; serviceClick?: string | RegExp } = {},
): Promise<void> {
  const concern =
    opts.concern ?? "my brakes are squealing when I come to a stop";
  const serviceClick = opts.serviceClick ?? /other.*issue/i;

  await completeGreeting(page, "returning");
  await completePhoneAndName(page);
  await completeOtp(page);
  await completeVehiclePick(page);
  // Service picker
  await page.getByRole("button", { name: serviceClick }).click();
  // Concern free-text (only fires for the "other issue" LLM path)
  const concernBox = page.getByRole("textbox", {
    name: /describe.*concern|tell.*about/i,
  });
  const visible = await concernBox
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  if (visible) {
    await concernBox.fill(concern);
    await page.getByRole("button", { name: /continue/i }).click();
    // Wait for diagnostic LLM to surface a recommendation
    await expect(
      page.getByText(/inspection|test|diagnostic/i),
    ).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /(accept|approve|continue)/i }).click();
  }
  // Appointment type — default to dropoff for fastest path
  await pickAppointmentType(page, "dropoff");
  await pickFirstAvailableDate(page);
  await expectSummaryCard(page);
}

/**
 * Test-suite-wide skip predicate. Use at the top of every spec.
 */
export const SKIP_REASON_IF_NO_TEST_PHONE =
  "PLAYWRIGHT_TEST_PHONE_E164 not set. " +
  "Set the env var to a phone that matches SCHEDULER_TEST_PHONE_E164 " +
  "on the target Supabase project AND Vercel project. " +
  "See e2e/README.md.";

export const SKIP_IF_NO_TEST_PHONE =
  !TEST_PHONE || process.env.SKIP_PLAYWRIGHT_E2E === "1";
