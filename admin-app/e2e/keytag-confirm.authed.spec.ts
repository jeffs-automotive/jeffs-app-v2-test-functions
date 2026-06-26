import { test, expect } from "@playwright/test";
import { resolveServiceRoleKey, resolveSupabaseUrl } from "../src/lib/supabase/resolve-keys";

/**
 * B1 repro / regression guard (keytag-audit-fixes).
 *
 * Force-assign is a Pattern-A (two-step) confirmation flow: the FIRST Server
 * Action call issues a token + returns needs_confirmation; the ConfirmationDialog's
 * Confirm must re-dispatch a SECOND call (with the token) that applies the assign.
 *
 * The board-fix series (cd91ecf) wrapped each tab in <Suspense>; every Server
 * Action on the force-dynamic /keytags route re-renders the route, so the first
 * call re-suspends LiveBoardTab and UNMOUNTS AssignKeytagForm (in BoardBackupTools),
 * wiping useActionState + the issued token before Confirm — the live "force_assign
 * tokens issued but never consumed" bug (8 orphaned since 2026-06-24).
 *
 * Driven against the MSW-SSR orchestrator stub (KEYTAG_E2E_MOCK=1, see
 * instrumentation.ts) so it's deterministic and touches no real Tekmetric/keytag
 * data. RED on the broken build (dialog unmounts → no success), GREEN after the fix.
 */
test("force-assign: confirmation dialog survives the action re-render and Confirm applies the assign", async ({
  page,
}) => {
  test.skip(
    !(resolveSupabaseUrl() && resolveServiceRoleKey()),
    "no test Supabase creds — run `npx vercel env pull .env.local` in admin-app",
  );

  // Reach the Board tab the way an operator does — land on /keytags (defaults to
  // Dashboard) and CLICK the Board tab. This matters: a tab click persists via
  // window.history.replaceState (invisible to the Next router), so the server still
  // computes defaultValue='dashboard'. A ?tab=live URL would hide that desync.
  await page.goto("/keytags");
  await page.getByRole("tab", { name: "Board", exact: true }).click();
  await expect(page.locator("#assign-ro")).toBeVisible();

  // Force-assign a specific tag (color + number) → Pattern A confirmation required.
  await page.locator("#assign-ro").fill("999999");
  await page.locator("#assign-color").selectOption("red");
  await page.locator("#assign-num").fill("17");
  await page
    .locator("form:has(#assign-ro)")
    .getByRole("button", { name: /assign/i })
    .click();

  // Step 1: the confirmation dialog must appear …
  const confirmBtn = page.getByRole("button", { name: /confirm assign tag/i });
  await expect(confirmBtn).toBeVisible();

  // … and STAY mounted. On the broken build the action re-render unmounts the form
  // (and its dialog) within a few hundred ms; this is the regression assertion.
  await page.waitForTimeout(1500);
  await expect(confirmBtn).toBeVisible();

  // Step 2: Confirm re-dispatches WITH the token → the assign applies.
  await confirmBtn.click();
  await expect(page.getByText(/Assigned to RO #999999/i)).toBeVisible();
});
