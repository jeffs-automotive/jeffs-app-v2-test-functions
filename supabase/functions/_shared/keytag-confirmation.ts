// Confirmation token utility for sensitive keytag operations.
//
// Two-step flow:
//   1. Tool called WITHOUT confirmation_token → emits a ConfirmationRequired
//      result with token_id + scope_summary + a fresh scope_hash. Tool layer
//      writes the token via create_keytag_confirmation_token RPC.
//   2. Tool re-called WITH confirmation_token → tool calls
//      consume_keytag_confirmation_token RPC; on ok the mutation proceeds.
//
// The scope hash binds the token to the EXACT operation. An attacker who
// captures a token cannot reuse it for a different RO. The user_label
// binding means the same OAuth identity that requested must confirm.
//
// Token lifetime: 5 minutes (DB-enforced).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ConfirmationActionKind =
  | "release_ar_tag"
  | "release_wip_tag"
  | "revert_to_assigned"
  | "mark_posted"
  | "force_assign"
  | "bulk_release"
  | "bulk_mark_posted"
  | "bulk_revert"
  | "bulk_force_assign";

export interface ConfirmationScope {
  /** Sorted list of RO numbers this action targets (one or many). */
  ro_numbers: number[];
  /** Optional tag color (for actions that specify a tag explicitly). */
  tag_color?: "red" | "yellow" | null;
  /** Optional tag number (paired with tag_color). */
  tag_number?: number | null;
  /** Optional canonical reason string (only matters when reason changes semantics). */
  reason?: string | null;
}

/**
 * Deterministic canonicalization of the operation scope. The hash binds
 * the confirmation token to the EXACT mutation set. Issued-time and
 * consume-time scope_hash MUST match — otherwise the consume RPC rejects.
 */
export async function computeScopeHash(
  actionKind: ConfirmationActionKind,
  scope: ConfirmationScope,
): Promise<string> {
  const canonical = JSON.stringify({
    action_kind: actionKind,
    ro_numbers: [...scope.ro_numbers].sort((a, b) => a - b),
    tag_color: scope.tag_color ?? null,
    tag_number: scope.tag_number ?? null,
    reason: scope.reason ?? null,
  });
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Human-readable summary surfaced back to the user for confirmation. */
export function renderScopeSummary(
  actionKind: ConfirmationActionKind,
  scope: ConfirmationScope,
): string {
  const tagPart =
    scope.tag_color && scope.tag_number
      ? `${scope.tag_color === "red" ? "Red" : "Yellow"} ${scope.tag_number}`
      : "tag";
  const roPart =
    scope.ro_numbers.length === 1
      ? `RO #${scope.ro_numbers[0]}`
      : `${scope.ro_numbers.length} ROs (${scope.ro_numbers.slice(0, 10).map((n) => `#${n}`).join(", ")}${scope.ro_numbers.length > 10 ? `, +${scope.ro_numbers.length - 10} more` : ""})`;

  switch (actionKind) {
    case "release_ar_tag":
      return `Release A/R key tag from ${roPart} (currently in posted_ar status). ${tagPart} will return to the available pool.`;
    case "release_wip_tag":
      return `Release WIP key tag from ${roPart}. ${tagPart} will return to the available pool.`;
    case "revert_to_assigned":
      return `Revert ${tagPart} on ${roPart} from posted_ar back to assigned (A/R un-posted).`;
    case "mark_posted":
      return `Mark ${tagPart} on ${roPart} as posted_ar (sent to A/R).`;
    case "force_assign":
      return `Force-assign ${tagPart} to ${roPart} (overrides round-robin selection).`;
    case "bulk_release":
      return `Bulk release: clear key tags from ${roPart}.`;
    case "bulk_mark_posted":
      return `Bulk mark posted_ar on ${roPart}.`;
    case "bulk_revert":
      return `Bulk revert ${roPart} from posted_ar back to assigned.`;
    case "bulk_force_assign":
      return `Bulk force-assign tags to ${roPart}.`;
  }
}

export interface IssuedConfirmationToken {
  token_id: string;
  expires_at: string;
  scope_hash: string;
  scope_summary: string;
  action_kind: ConfirmationActionKind;
}

/**
 * Issues a fresh confirmation token bound to (action_kind, scope, user_label).
 * Returns the token + scope hash + human-readable summary. Tool layer returns
 * these to the orchestrator, which presents to the user for confirmation.
 */
export async function issueConfirmationToken(
  sb: SupabaseClient,
  args: {
    actionKind: ConfirmationActionKind;
    scope: ConfirmationScope;
    userLabel: string;
  },
): Promise<IssuedConfirmationToken> {
  const { actionKind, scope, userLabel } = args;
  if (!userLabel || userLabel.trim().length === 0) {
    throw new Error("issueConfirmationToken: userLabel is required");
  }
  const scopeHash = await computeScopeHash(actionKind, scope);
  const scopeSummary = renderScopeSummary(actionKind, scope);
  const { data, error } = await sb.rpc("create_keytag_confirmation_token", {
    p_action_kind: actionKind,
    p_scope_hash: scopeHash,
    p_scope_summary: scopeSummary,
    p_user_label: userLabel,
  });
  if (error) {
    throw new Error(`create_keytag_confirmation_token failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.token_id) {
    throw new Error("create_keytag_confirmation_token returned no token");
  }
  return {
    token_id: row.token_id as string,
    expires_at: row.expires_at as string,
    scope_hash: scopeHash,
    scope_summary: scopeSummary,
    action_kind: actionKind,
  };
}

export interface ConfirmationConsumeResult {
  ok: boolean;
  failure_reason?:
    | "token_not_found"
    | "token_already_consumed"
    | "token_expired"
    | "action_kind_mismatch"
    | "scope_hash_mismatch"
    | "user_label_mismatch";
  scope_summary?: string | null;
}

/**
 * Atomically consume a previously-issued confirmation token. Returns ok=true
 * only when (token_id, action_kind, scope_hash, user_label) all match the
 * issuance values AND the token is unexpired AND unconsumed.
 */
export async function consumeConfirmationToken(
  sb: SupabaseClient,
  args: {
    tokenId: string;
    actionKind: ConfirmationActionKind;
    scope: ConfirmationScope;
    userLabel: string;
  },
): Promise<ConfirmationConsumeResult> {
  const { tokenId, actionKind, scope, userLabel } = args;
  const scopeHash = await computeScopeHash(actionKind, scope);
  const { data, error } = await sb.rpc("consume_keytag_confirmation_token", {
    p_token_id: tokenId,
    p_action_kind: actionKind,
    p_scope_hash: scopeHash,
    p_user_label: userLabel,
  });
  if (error) {
    return {
      ok: false,
      failure_reason: "token_not_found",
      scope_summary: null,
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, failure_reason: "token_not_found" };
  }
  return {
    ok: row.ok as boolean,
    failure_reason:
      row.failure_reason as ConfirmationConsumeResult["failure_reason"],
    scope_summary: (row.scope_summary as string | null) ?? null,
  };
}

/** Common discriminated union for tools that emit confirmation requests. */
export type ConfirmationRequiredResult = {
  ok: false;
  needs_confirmation: true;
  confirmation: {
    token_id: string;
    expires_at: string;
    action_kind: ConfirmationActionKind;
    scope_summary: string;
  };
  message: string;
};

export function confirmationRequiredResponse(
  issued: IssuedConfirmationToken,
): ConfirmationRequiredResult {
  return {
    ok: false,
    needs_confirmation: true,
    confirmation: {
      token_id: issued.token_id,
      expires_at: issued.expires_at,
      action_kind: issued.action_kind,
      scope_summary: issued.scope_summary,
    },
    message:
      `Confirmation required: ${issued.scope_summary} ` +
      `Re-call the same tool with confirmation_token="${issued.token_id}" within 5 minutes to proceed. ` +
      `If this is not what the advisor intended, do NOT confirm.`,
  };
}

/** Tool-call argument helper: extract + validate a confirmation_token field. */
export function readConfirmationTokenArg(
  raw: unknown,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  // Basic UUID v4-ish sanity check; consume RPC does the real validation
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}
