// config — keytag-bulk-reconcile module.
// Extracted from keytag-bulk-reconcile/index.ts (file-size-refactor). Mechanical split.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ENV_NAMES } from "../_shared/tekmetric.ts";
import { RESOLVED_SERVICE_ROLE_KEY } from "../_shared/scheduler-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);

// Pagination: Tekmetric's max size per page is 100.
export const PAGE_SIZE = 100;

// Throttle PATCHes so we stay well under the 600 req/min Tekmetric prod limit.
// Average reconcile ≈ 150 ROs; at 10/sec we finish in ~15s.
export const PATCH_DELAY_MS = 100;
// ── Supabase client (service role) ──────────────────────────────────────────

export const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
