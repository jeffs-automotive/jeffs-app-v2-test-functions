import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createSupabaseAdminClient,
  __resetAdminClientForTests,
} from "@/lib/supabase/admin";

/**
 * Unit tests for the service-role admin client factory.
 *
 * The actual @supabase/supabase-js createClient is not mocked here — the
 * client is constructed lazily and only the URL + key need to be set for
 * construction to succeed. Network calls happen on .from(...) usage which
 * is tested separately in the chat-store DAL tests with MSW.
 */

describe("createSupabaseAdminClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetAdminClientForTests();
    process.env.SUPABASE_URL = "https://test-project.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    __resetAdminClientForTests();
  });

  it("returns a SupabaseClient when env vars are set", () => {
    const client = createSupabaseAdminClient();
    expect(client).toBeDefined();
    // Sanity-check it has the from() method (basic SupabaseClient surface)
    expect(typeof client.from).toBe("function");
  });

  it("returns the same instance on repeated calls (caching)", () => {
    const a = createSupabaseAdminClient();
    const b = createSupabaseAdminClient();
    expect(a).toBe(b);
  });

  it("throws a clear error when SUPABASE_URL is missing", () => {
    delete process.env.SUPABASE_URL;
    expect(() => createSupabaseAdminClient()).toThrow(/SUPABASE_URL/);
  });

  it("throws a clear error when SUPABASE_SECRET_KEY is missing", () => {
    delete process.env.SUPABASE_SECRET_KEY;
    expect(() => createSupabaseAdminClient()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("error message points to vercel env pull as the recovery", () => {
    delete process.env.SUPABASE_URL;
    expect(() => createSupabaseAdminClient()).toThrow(/vercel env pull/);
  });

  it("__resetAdminClientForTests() clears the cache", () => {
    const a = createSupabaseAdminClient();
    __resetAdminClientForTests();
    const b = createSupabaseAdminClient();
    expect(a).not.toBe(b);
  });
});
