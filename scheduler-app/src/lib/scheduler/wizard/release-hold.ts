/**
 * releaseSessionHold — release the appointment_holds row a session is
 * holding, so re-entering the slot flow forms a fresh hold instead of
 * double-holding (2026-07-04, extracted from submit-back.ts:100-123).
 *
 * Sets `released_at = now()` on the hold row keyed by `holdToken`, filtered
 * on `released_at IS NULL` so a double-call is a silent no-op. Does NOT
 * clear `hold_token` on the session row — the caller's applyWizardTransition
 * write owns that (pass `hold_token: null` in its updates).
 *
 * Lives in its own module (not submit-back.ts) because that file is
 * "use server"-flagged and Next.js only allows async-function exports from
 * action modules — a shared plain helper can't live there. Both submit-back
 * and submit-edit-hub (the summary-edit-hub "edit time" path) call this so
 * the release mechanics stay identical.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function releaseSessionHold(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  holdToken: string,
): Promise<void> {
  await supabase
    .from("appointment_holds")
    .update({ released_at: new Date().toISOString() })
    .eq("id", holdToken)
    .is("released_at", null);
}
