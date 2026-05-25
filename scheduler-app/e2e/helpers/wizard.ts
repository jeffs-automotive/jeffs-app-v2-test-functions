/**
 * Shared Playwright helpers for the scheduler wizard E2E suite.
 *
 * 2026-05-25 — extracted from `wizard-happy-path.spec.ts` so multiple
 * specs can compose the wizard's stages without duplicating selectors.
 *
 * 2026-05-25 (later) — selectors hardened against the actual rendered
 * card markup after the first smoke run failed at PhoneName. Sources of
 * truth for every selector below:
 *   - GreetingCard.tsx, PhoneNameCard.tsx, ConcernExplanationCard.tsx,
 *     AppointmentTypeCard.tsx, SummaryCard.tsx, CustomerNotesCard.tsx
 *     in src/components/scheduler/heritage/
 *   - OtpInput.tsx, VehiclePicker.tsx, CalendarDatePicker.tsx,
 *     WaiterTimePicker.tsx, ServiceAndConcernPicker.tsx in
 *     src/components/scheduler/
 *   - submit-summary.ts (test-bypass branch) in
 *     src/lib/scheduler/wizard/actions/
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

/** Plausible first/last name used by the PhoneName card. */
export const TEST_FIRST_NAME = "Playwright";
export const TEST_LAST_NAME = "Tester";

/**
 * Strip "+1" from E.164 phone to match the wizard's tel-input format.
 * The wizard accepts loose input (US phone with or without country code).
 */
export function formatPhoneForInput(e164: string): string {
  return e164.replace(/^\+1/, "");
}

/**
 * OtpInput renders 6 separate `<input>` elements with `aria-label="Digit N of 6"`.
 * Only the first carries `autoComplete="one-time-code"`; the rest have `"off"`.
 * The card AUTO-SUBMITS when all 6 digits are filled — there is NO verify
 * button. We type one digit per box (focus auto-advances).
 */
export async function fillOtp(page: Page, code: string): Promise<void> {
  // Prefer the canonical aria-label since it's stable across the 6 boxes.
  const otpInputs = page.getByRole("textbox", { name: /^Digit \d of 6$/ });
  const count = await otpInputs.count();
  if (count >= 6) {
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(code[i] ?? "");
    }
    return;
  }
  // Defensive fallback: try the autocomplete=one-time-code first input
  // (which can absorb a paste of all 6 digits in some browsers).
  const firstByAutocomplete = page
    .locator('input[autocomplete="one-time-code"]')
    .first();
  await firstByAutocomplete.fill(code);
}

/**
 * Step 1 — Greeting: pick one of three buttons.
 *
 * Title: "Hi, I'm Jeff 👋" (or {agent_name} prop). The 👋 is OUTSIDE the
 * apostrophe so `getByRole("heading", { name: /Hi, I'?m/i })` matches.
 *
 * Buttons (exact label strings):
 *   - "Yes — I'm a returning customer"  (em-dash + curly apostrophe)
 *   - "No — first time"
 *   - "I'm not sure"
 *
 * `variant: "info_only"` is preserved for API compatibility but maps to
 * "I'm not sure" since that's the third available option in the UI.
 */
export async function completeGreeting(
  page: Page,
  variant: "returning" | "new" | "info_only" = "returning",
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /Hi, I.?m\s+\w+/i }),
  ).toBeVisible({ timeout: 30_000 });
  const buttonName =
    variant === "returning"
      ? /returning customer/i
      : variant === "new"
        ? /first time/i
        : /not sure/i;
  await page.getByRole("button", { name: buttonName }).click();
}

/**
 * Step 2 — Phone + Name (returning-customer path). Fills First name,
 * Last name, and Phone, then clicks "Send my code".
 *
 * All three fields are REQUIRED — failing to fill any of them causes the
 * form to refuse submission. The phone input formats as the customer
 * types (10-digit US), so we just feed it the stripped E.164.
 */
export async function completePhoneAndName(page: Page): Promise<void> {
  await page
    .getByRole("textbox", { name: /^First name$/i })
    .fill(TEST_FIRST_NAME);
  await page
    .getByRole("textbox", { name: /^Last name$/i })
    .fill(TEST_LAST_NAME);
  await page
    .getByRole("textbox", { name: /^Phone number$/i })
    .fill(formatPhoneForInput(TEST_PHONE));
  await page.getByRole("button", { name: /send.*code/i }).click();
}

/**
 * Step 3 — OTP. Static code from TEST_OTP_CODE; OtpInput auto-submits when
 * the 6th digit lands, so there's no verify button to click. We DO wait
 * for the next card to appear (vehicle picker OR new-customer-info) as
 * an implicit submit-success signal.
 */
export async function completeOtp(page: Page): Promise<void> {
  await fillOtp(page, TEST_OTP_CODE);
  // Wait for the OTP card to disappear OR for a downstream card heading.
  // We don't assert on a specific next-step here — the caller's next
  // helper (completeVehiclePick / etc.) will own that assertion.
}

/**
 * Step 4 — Vehicle pick. VehiclePicker renders each vehicle as a
 * `<button aria-pressed="false">` (NOT `role="radio"`). Picking
 * auto-submits via `onSubmit({ vehicle_id })` — there is NO Continue
 * button. Card may not appear at all for single-vehicle accounts where
 * the orchestrator auto-advances.
 */
export async function completeVehiclePick(page: Page): Promise<void> {
  const vehicleCard = page.getByRole("heading", {
    name: /Which one are we taking care of/i,
  });
  const visible = await vehicleCard
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
  if (!visible) return;
  // Vehicle tiles are `<button aria-pressed>` inside the card body.
  // We avoid matching the "+ Add a vehicle" tile by picking the first
  // button that is NOT named "Add a vehicle".
  const tiles = page
    .getByRole("button", { name: /.+/ })
    .filter({ hasNot: page.getByText(/add a vehicle/i) });
  // Narrower selector: the tile buttons live inside the card's <ul>; the
  // first real vehicle tile is the first such button.
  const firstVehicle = page
    .locator('button[aria-pressed]')
    .filter({ hasNotText: /add a vehicle/i })
    .first();
  // Prefer the more specific locator, fall back to the broader one.
  if ((await firstVehicle.count()) > 0) {
    await firstVehicle.click();
  } else {
    await tiles.first().click();
  }
}

/**
 * Step 5a — Appointment type pick (waiter vs dropoff).
 *
 * Title: "Waiter or dropoff?"
 * Eyebrow: "How would you like to come in?"
 *
 * The two options are full-card BUTTONS (not pills) whose accessible
 * names compose from the icon + title + description:
 *   - waiter   → "☕ Wait while we work — Grab a coffee — most waiter…"
 *   - dropoff  → "🚗 Drop off in the morning — Drop your car off by 10 AM…"
 *
 * Clicking auto-submits — no separate continue button.
 *
 * One option may be DISABLED when the service mix isn't wait-eligible
 * (e.g. brake job). Disabled buttons are still in the DOM but with
 * `disabled` attribute, so the locator targets the enabled match.
 */
export async function pickAppointmentType(
  page: Page,
  type: "waiter" | "dropoff",
): Promise<void> {
  const apptCard = page.getByRole("heading", {
    name: /Waiter or dropoff/i,
  });
  const visible = await apptCard
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
  if (!visible) return;
  const buttonName =
    type === "waiter" ? /wait while we work/i : /drop off in the morning/i;
  await page
    .getByRole("button", { name: buttonName })
    .first()
    .click();
}

/**
 * Step 6 — Date pick. CalendarDatePicker renders enabled date cells as
 * `<button role="gridcell">` with aria-label like "Monday, May 25"
 * (NO year — see CalendarDatePicker line 225-229 toLocaleDateString
 * weekday + month + day only). Disabled (unavailable) cells carry
 * `aria-disabled="true"` AND have " (unavailable)" appended to the
 * aria-label. We pick the first ENABLED date button.
 */
export async function pickFirstAvailableDate(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /Pick a date that works/i }),
  ).toBeVisible({ timeout: 30_000 });
  // CalendarDatePicker uses role="gridcell" on every day button (including
  // padding cells which are non-button divs). The available buttons have
  // a weekday-month-day aria-label WITHOUT a "(unavailable)" suffix.
  // We anchor on the weekday word pattern and exclude disabled cells.
  const firstEnabled = page
    .locator(
      'button[role="gridcell"]:not([aria-disabled="true"]):not([disabled])',
    )
    .first();
  await firstEnabled.click();
}

/**
 * Step 7 — Waiter time pick (only fires on waiter path).
 *
 * Title: "What time works? ☕"
 *
 * Buttons render as e.g. "8 AM" / "9 AM" (single space, no minutes when
 * on-the-hour — see WaiterTimePicker.formatHHMMForDisplay). They are
 * plain `<button>` tiles with no extra disabling unless the slot is gone.
 */
export async function pickFirstAvailableWaiterTime(page: Page): Promise<void> {
  const timeCard = page.getByRole("heading", {
    name: /What time works/i,
  });
  const visible = await timeCard
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
  if (!visible) return;
  const enabled = page
    .getByRole("button", { name: /^\d{1,2}(:\d{2})?\s?(AM|PM)$/i })
    .first();
  await enabled.click();
}

/**
 * Step 8 — Summary card lands.
 *
 * Title: "Quick look — does this all look right? ✅"
 * Eyebrow: "Review before confirming"
 */
export async function expectSummaryCard(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", {
      name: /Quick look|does this all look right/i,
    }),
  ).toBeVisible({ timeout: 60_000 });
}

/**
 * Step 9 — Confirm + verify Tekmetric bypass landed at customer_notes.
 * Requires `SCHEDULER_TEST_PHONE_E164` set on the Vercel deployment
 * (matches Supabase OTP bypass + adds the Tekmetric POST skip).
 *
 * Confirm button label: "Confirm appointment 🔑"
 *
 * Post-confirm jeffBubble from submit-summary.ts line 561-562:
 *   "🧪 [TEST MODE] Wizard complete — Tekmetric POST skipped, no real
 *    appointment created.
 *
 *    Before you go — is there anything special I should let our techs
 *    know about your car or the visit?"
 *
 * The page then advances to customer_notes which renders a card titled
 * "Anything else our team should know? 🛠️" — we don't assert on the
 * card heading here since the bubble proves the bypass fired.
 */
export async function confirmAndExpectTestBypass(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /Confirm appointment/i })
    .click();
  // The 🧪 marker uniquely identifies the test-bypass branch.
  await expect(page.getByText(/\[TEST MODE\]/i)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(/anything special.*let our techs know/i),
  ).toBeVisible({ timeout: 5_000 });
}

/**
 * Convenience composer for the most common path: greeting → phone → OTP
 * → vehicle → service → date → summary. Stops just BEFORE confirm so the
 * caller can branch (confirm vs edit).
 *
 * Service picker:
 *   Heading: "What's the visit for? 🛠️"
 *   "Other issue" tile is below a gold divider with label "💬 Other issue"
 *   Submit button at the bottom: "Continue" (multi-select submit).
 *
 * Concern textarea (ConcernExplanationCard):
 *   Field label: "In your own words"
 *   Placeholder: "Tell me what you're noticing — even rough details help."
 *   Submit button: "Continue"
 */
export async function progressToSummary(
  page: Page,
  opts: { concern?: string; serviceClick?: string | RegExp } = {},
): Promise<void> {
  const concern =
    opts.concern ?? "my brakes are squealing when I come to a stop";
  // Match the "💬 Other issue" tile by its label.
  const serviceClick = opts.serviceClick ?? /other issue/i;

  await completeGreeting(page, "returning");
  await completePhoneAndName(page);
  await completeOtp(page);
  await completeVehiclePick(page);

  // Service picker: tick the "Other issue" tile, then submit.
  // The tile is a <button aria-pressed> — toggling it just marks it
  // selected; the Continue button fires the action.
  await page.getByRole("button", { name: serviceClick }).first().click();
  await page
    .getByRole("button", { name: /^Continue$/ })
    .first()
    .click();

  // Concern explanation card — the placeholder text is unique enough to
  // anchor on. Field label is "In your own words" but the textarea is
  // most reliably found by placeholder.
  const concernBox = page.getByPlaceholder(
    /tell me what you.?re noticing/i,
  );
  const concernVisible = await concernBox
    .isVisible({ timeout: 10_000 })
    .catch(() => false);
  if (concernVisible) {
    await concernBox.fill(concern);
    await page.getByRole("button", { name: /^Continue$/ }).click();
    // Wait for diagnostic LLM to surface a recommendation (testing card
    // OR the next stage). The TestingServiceApprovalCard title says
    // "We'd like to look at a couple of things." with a "Looks good —
    // schedule these" / "Skip testing for now" button.
    const testingHeading = page.getByRole("heading", {
      name: /look at a couple of things/i,
    });
    const testingVisible = await testingHeading
      .isVisible({ timeout: 60_000 })
      .catch(() => false);
    if (testingVisible) {
      await page
        .getByRole("button", {
          name: /Looks good|Schedule \d|Skip testing/i,
        })
        .click();
    }
  }
  // Appointment type — default to dropoff for fastest path (skips waiter time pick).
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
