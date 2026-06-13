import { test, expect } from "@playwright/test";

/**
 * PLAN-01 Phase 4D — wizard smoke test.
 *
 * Validates the wizard surface loads without a Next.js build error,
 * the Sentry-wrapped error boundary isn't triggered, and the greeting
 * card renders correctly. This is the catch-everything-catastrophic
 * test that should run on every deploy.
 *
 * Companion: `wizard-happy-path.spec.ts` exercises a full booking flow
 * end-to-end, gated on the `PLAYWRIGHT_TEST_PHONE_E164` env var.
 */

test.describe("wizard smoke", () => {
  test("greeting card renders at /book", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => {
      errors.push(err.message);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    await page.goto("/book", { waitUntil: "domcontentloaded" });

    // GreetingCard renders "Hi, I'm <agent_name> 👋" with the customer-recorded
    // notice + "Have you been to our shop before?" prompt + 3 choice buttons.
    await expect(
      page.getByRole("heading", { name: /Hi, I'?m\s+\w+/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/Have you been to our shop before/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Yes.*returning customer/i }),
    ).toBeVisible();

    // No client-side errors leaked through. (Filter out third-party noise
    // like X-Frame-Options + 3rd-party cookies that some browsers log.)
    const realErrors = errors.filter(
      (e) =>
        !e.includes("X-Frame-Options") &&
        !e.includes("third-party cookies") &&
        !e.includes("Failed to load resource"),
    );
    expect(realErrors).toEqual([]);
  });

  test("error boundary not visible on load", async ({ page }) => {
    await page.goto("/book", { waitUntil: "domcontentloaded" });
    // app/error.tsx renders "Something went sideways." when the wizard
    // crashes. If that string is on the page, the wizard is broken before
    // any interaction.
    await expect(page.getByText(/Something went sideways/i)).not.toBeVisible();
  });
});
