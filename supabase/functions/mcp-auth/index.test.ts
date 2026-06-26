// Tests for the mcp-auth OAuth 2.1 refresh-token grant — M7 reuse detection +
// token-family revocation, and the happy-path rotation that must keep working
// for Claude Desktop.
//
// Coverage:
//   1. status=rotated  → 200, new access+refresh issued via oauth_issue_token_pair
//   2. status=reuse (same client) → 400 invalid_grant + oauth_revoke_token_family
//      called with the consumed token's family_id (theft → kill the chain)
//   3. status=reuse (DIFFERENT client) → 400 invalid_grant but family NOT swept
//      (cross-client DoS gate — the family sweep is scoped to the auth'd client)
//   4. status=invalid → 400 invalid_grant, no revoke
//   5. missing refresh_token → 400 invalid_request
//
// The test drives handleRefreshTokenGrant() directly with a mock Supabase
// client injected via _setSupabaseClientForTesting(). Sentry no-ops (no DSN).
//
// Run: deno test --allow-all --no-check supabase/functions/mcp-auth/index.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from "../_shared/test-helpers.ts";

// mcp-auth reads SUPABASE_URL via getIssuerUrl() inside getExpectedMcpResource()
// only on the /authorize + /token-code paths; the refresh path doesn't need it,
// but the module's Proxy lazy-init never fires because we inject a mock client.
// Set a dummy so any incidental functionUrl() call doesn't throw.
Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");

const { handleRefreshTokenGrant, _setSupabaseClientForTesting } = await import(
  "./index.ts"
);

const CLIENT_ID = "mcp_testclient000000000000";
const OTHER_CLIENT_ID = "mcp_attacker0000000000000";
const FAMILY_ID = "11111111-2222-3333-4444-555555555555";

/** A public PKCE client row (no secret) so authenticateTokenClient passes with
 *  just client_id in the form body. */
function configureClientLookup(sb: MockSupabaseClient, clientId = CLIENT_ID): void {
  sb.onTable("oauth_clients", {
    data: {
      id: clientId,
      client_secret_hash: null,
      redirect_uris: ["https://example.com/cb"],
      active: true,
      token_endpoint_auth_method: "none",
    },
    error: null,
  });
}

function refreshReq(clientId = CLIENT_ID, refreshToken = "rt-raw-value"): {
  req: Request;
  params: URLSearchParams;
} {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const req = new Request("http://localhost/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return { req, params };
}

Deno.test("refresh grant — status=rotated → 200 + issues new pair atomically", async () => {
  const sb = createMockSupabaseClient();
  configureClientLookup(sb);
  sb.onRpc("oauth_consume_refresh_token", {
    data: [{
      status: "rotated",
      user_label: "Claude",
      scope: "mcp",
      client_id: CLIENT_ID,
      resource: "https://test.supabase.co/functions/v1/orchestrator-mcp",
      family_id: FAMILY_ID,
    }],
    error: null,
  });
  sb.onRpc("oauth_issue_token_pair", { data: null, error: null });
  _setSupabaseClientForTesting(sb);

  const { req, params } = refreshReq();
  const res = await handleRefreshTokenGrant(req, params);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(typeof body.access_token, "string");
  assertEquals(typeof body.refresh_token, "string");
  assertEquals(body.token_type, "Bearer");

  // Issued via the atomic RPC (L4) carrying the inherited family_id.
  const issue = sb.callsForRpc("oauth_issue_token_pair");
  assertEquals(issue.length, 1);
  const args = issue[0].rpcArgs as Record<string, unknown>;
  assertEquals(args.p_family_id, FAMILY_ID);
  assertEquals(args.p_parent_token_hash !== null, true);
  // No family revocation on the happy path.
  assertEquals(sb.callsForRpc("oauth_revoke_token_family").length, 0);
});

Deno.test("refresh grant — status=reuse (same client) → 400 + family revoked", async () => {
  const sb = createMockSupabaseClient();
  configureClientLookup(sb);
  sb.onRpc("oauth_consume_refresh_token", {
    data: [{
      status: "reuse",
      user_label: "Claude",
      scope: "mcp",
      client_id: CLIENT_ID,
      resource: "https://test.supabase.co/functions/v1/orchestrator-mcp",
      family_id: FAMILY_ID,
    }],
    error: null,
  });
  sb.onRpc("oauth_revoke_token_family", {
    data: [{ refresh_revoked: 1, access_revoked: 0 }],
    error: null,
  });
  _setSupabaseClientForTesting(sb);

  const { req, params } = refreshReq();
  const res = await handleRefreshTokenGrant(req, params);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "invalid_grant");

  // The whole family was revoked, scoped to the consumed token's family_id.
  const revoke = sb.callsForRpc("oauth_revoke_token_family");
  assertEquals(revoke.length, 1);
  assertEquals((revoke[0].rpcArgs as Record<string, unknown>).p_family_id, FAMILY_ID);
  // No new pair issued.
  assertEquals(sb.callsForRpc("oauth_issue_token_pair").length, 0);
});

Deno.test("refresh grant — status=reuse but token belongs to a DIFFERENT client → no family sweep", async () => {
  const sb = createMockSupabaseClient();
  // Caller authenticates as OTHER_CLIENT_ID...
  configureClientLookup(sb, OTHER_CLIENT_ID);
  // ...but the replayed (revoked) token's family belongs to CLIENT_ID.
  sb.onRpc("oauth_consume_refresh_token", {
    data: [{
      status: "reuse",
      user_label: "Claude",
      scope: "mcp",
      client_id: CLIENT_ID, // victim's client, not the caller
      resource: null,
      family_id: FAMILY_ID,
    }],
    error: null,
  });
  sb.onRpc("oauth_revoke_token_family", {
    data: [{ refresh_revoked: 0, access_revoked: 0 }],
    error: null,
  });
  _setSupabaseClientForTesting(sb);

  const { req, params } = refreshReq(OTHER_CLIENT_ID);
  const res = await handleRefreshTokenGrant(req, params);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "invalid_grant");

  // DoS gate: the family sweep is NOT triggered for an unrelated client.
  assertEquals(sb.callsForRpc("oauth_revoke_token_family").length, 0);
});

Deno.test("refresh grant — status=invalid → 400 invalid_grant, no revoke", async () => {
  const sb = createMockSupabaseClient();
  configureClientLookup(sb);
  sb.onRpc("oauth_consume_refresh_token", {
    data: [{
      status: "invalid",
      user_label: null,
      scope: null,
      client_id: null,
      resource: null,
      family_id: null,
    }],
    error: null,
  });
  _setSupabaseClientForTesting(sb);

  const { req, params } = refreshReq();
  const res = await handleRefreshTokenGrant(req, params);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "invalid_grant");
  assertEquals(sb.callsForRpc("oauth_revoke_token_family").length, 0);
  assertEquals(sb.callsForRpc("oauth_issue_token_pair").length, 0);
});

Deno.test("refresh grant — missing refresh_token → 400 invalid_request", async () => {
  const sb = createMockSupabaseClient();
  _setSupabaseClientForTesting(sb);
  const params = new URLSearchParams({ grant_type: "refresh_token", client_id: CLIENT_ID });
  const req = new Request("http://localhost/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const res = await handleRefreshTokenGrant(req, params);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "invalid_request");
  assert(sb.callsForRpc("oauth_consume_refresh_token").length === 0);
});
