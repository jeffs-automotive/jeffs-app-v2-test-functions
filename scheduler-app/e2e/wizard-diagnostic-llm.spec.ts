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
 * Diagnostic LLM agent — exercises the "Other Issue" free-form concern
 * → LLM-driven service recommendation path. The LLM:
 *
 *   1. Reads the customer's free-form concern text
 *   2. Maps to one of N diagnostic categories (brake, AC, exhaust,
 *      check-engine, engine, transmission, electrical, suspension, etc.)
 *   3. Optionally asks clarification questions (1-2 rounds)
 *   4. Recommends a specific testing_service (e.g., brake_inspection,
 *      check_ac, exhaust_service)
 *
 * These tests verify the recommendation surfaces for distinct concern
 * categories. LLM responses are non-deterministic so we match on broad
 * keyword patterns (e.g., /brake/, /A/?C|cooling/) rather than exact
 * service names.
 *
 * Each test takes 60-120s due to LLM round-trips. They run in serial
 * (workers: 1 in playwright.config.ts) to avoid Tekmetric API rate
 * limits + Supabase row contention.
 */

test.describe("diagnostic LLM — concern → service recommendation", () => {
  test.skip(SKIP_IF_NO_TEST_PHONE, SKIP_REASON_IF_NO_TEST_PHONE);

  test("brake concern → brake_inspection recommendation", async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await completeGreeting(page, "returning");
    await completePhoneAndName(page);
    await completeOtp(page);
    await completeVehiclePick(page);

    await page.getByRole("button", { name: /other.*issue/i }).click();
    await page
      .getByRole("textbox", { name: /describe.*concern|tell.*about/i })
      .fill(
        "When I press the brake pedal there's a loud squealing sound and the car takes longer to stop",
      );
    await page.getByRole("button", { name: /continue/i }).click();

    // LLM may ask a clarification (e.g., "Does it happen all the time?").
    // Answer ANY clarification optimistically + proceed.
    await handleOptionalClarification(page, "Yes, every time I brake");

    // Final recommendation should mention brake-related service.
    await expect(
      page.getByText(/brake.*(inspection|test|service)/i),
    ).toBeVisible({ timeout: 90_000 });

    // Approve + push through to confirm
    await page
      .getByRole("button", { name: /(accept|approve|continue)/i })
      .click();
    await pickAppointmentType(page, "dropoff");
    await pickFirstAvailableDate(page);
    await expectSummaryCard(page);
    await confirmAndExpectTestBypass(page);
  });

  test("AC concern → check_ac (or AC-related) recommendation", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await completeGreeting(page, "returning");
    await completePhoneAndName(page);
    await completeOtp(page);
    await completeVehiclePick(page);

    await page.getByRole("button", { name: /other.*issue/i }).click();
    await page
      .getByRole("textbox", { name: /describe.*concern|tell.*about/i })
      .fill(
        "The air conditioning blows warm air even when I have it on max cold",
      );
    await page.getByRole("button", { name: /continue/i }).click();

    await handleOptionalClarification(
      page,
      "It started about a week ago, gets worse in hot weather",
    );

    // LLM should route to an AC/cooling-related testing service.
    await expect(
      page.getByText(/A.?C|air.?cond|cooling/i),
    ).toBeVisible({ timeout: 90_000 });

    await page
      .getByRole("button", { name: /(accept|approve|continue)/i })
      .click();
    await pickAppointmentType(page, "dropoff");
    await pickFirstAvailableDate(page);
    await expectSummaryCard(page);
    await confirmAndExpectTestBypass(page);
  });

  test("exhaust concern → exhaust_service recommendation", async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await completeGreeting(page, "returning");
    await completePhoneAndName(page);
    await completeOtp(page);
    await completeVehiclePick(page);

    await page.getByRole("button", { name: /other.*issue/i }).click();
    await page
      .getByRole("textbox", { name: /describe.*concern|tell.*about/i })
      .fill(
        "There's a loud rattle from underneath the car when I accelerate, sounds like a metal pipe is loose",
      );
    await page.getByRole("button", { name: /continue/i }).click();

    await handleOptionalClarification(
      page,
      "Mostly when I first start the car, then quieter",
    );

    // LLM should route to exhaust-related service.
    await expect(
      page.getByText(/exhaust|muffler|catalytic/i),
    ).toBeVisible({ timeout: 90_000 });

    await page
      .getByRole("button", { name: /(accept|approve|continue)/i })
      .click();
    await pickAppointmentType(page, "dropoff");
    await pickFirstAvailableDate(page);
    await expectSummaryCard(page);
    await confirmAndExpectTestBypass(page);
  });

  test("check-engine concern → check-engine inspection recommendation", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await completeGreeting(page, "returning");
    await completePhoneAndName(page);
    await completeOtp(page);
    await completeVehiclePick(page);

    await page.getByRole("button", { name: /other.*issue/i }).click();
    await page
      .getByRole("textbox", { name: /describe.*concern|tell.*about/i })
      .fill(
        "My check engine light came on yesterday and the car feels like it's running rough",
      );
    await page.getByRole("button", { name: /continue/i }).click();

    await handleOptionalClarification(
      page,
      "The light is solid, not blinking. Started after I filled up gas yesterday",
    );

    // LLM should route to a check-engine / code-read related service.
    await expect(
      page.getByText(/check.?engine|diagnostic|code/i),
    ).toBeVisible({ timeout: 90_000 });

    await page
      .getByRole("button", { name: /(accept|approve|continue)/i })
      .click();
    await pickAppointmentType(page, "dropoff");
    await pickFirstAvailableDate(page);
    await expectSummaryCard(page);
    await confirmAndExpectTestBypass(page);
  });
});

// ─── helpers ────────────────────────────────────────────────────────────

/**
 * The LLM may surface a clarification question card before settling on
 * a recommendation. If it appears within 30s, type the provided answer
 * and continue. If no card appears, proceed (no-op).
 *
 * Common clarification shapes:
 *   - Yes/No question with two choice buttons
 *   - Free-form follow-up text box
 *   - Multi-choice radio set (e.g., "All the time / Only cold start / Only highway")
 *
 * This helper handles all three shapes generously.
 */
async function handleOptionalClarification(
  page: import("@playwright/test").Page,
  answer: string,
): Promise<void> {
  // Look for a clarification heading OR a "follow-up" text input.
  const clarification = page.getByRole("heading", {
    name: /clarif|follow.?up|few more details|tell me more/i,
  });
  const visible = await clarification
    .isVisible({ timeout: 30_000 })
    .catch(() => false);
  if (!visible) return;

  // Try the free-form text path first (most common for the
  // diagnose-concern Stage 1 → Stage 2 flow).
  const textBox = page.getByRole("textbox").last();
  const hasTextBox = await textBox.isVisible({ timeout: 2_000 }).catch(() => false);
  if (hasTextBox) {
    await textBox.fill(answer);
    await page.getByRole("button", { name: /(continue|next)/i }).click();
    return;
  }

  // Fallback: pick the first radio / button option.
  const firstOption = page
    .locator('button:not([disabled]), [role="radio"]:not([aria-disabled="true"])')
    .first();
  await firstOption.click();
  await page
    .getByRole("button", { name: /(continue|next)/i })
    .click({ trial: true })
    .catch(() => undefined);
}
