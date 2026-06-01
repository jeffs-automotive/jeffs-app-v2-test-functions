import { describe, it, expect } from "vitest";
import {
  resolveServiceRoleKey,
  resolvePublishableKey,
  resolveSupabaseUrl,
} from "@/lib/supabase/resolve-keys";

/**
 * The key resolvers take `env` as their sole input (no global/client path).
 * These pin the 2026 multi-form precedence (JSON dict > singular > legacy) and
 * the null-when-missing contract. Security-relevant: resolveServiceRoleKey must
 * NOT fall back to any NEXT_PUBLIC_/anon source (that would send a god-mode key
 * where a public key belongs).
 */
const env = (o: Record<string, string>): NodeJS.ProcessEnv =>
  o as unknown as NodeJS.ProcessEnv;

describe("resolveServiceRoleKey", () => {
  it("prefers the JSON-dict form (first entry) over singular + legacy", () => {
    expect(
      resolveServiceRoleKey(
        env({
          SUPABASE_SECRET_KEYS: JSON.stringify(["dict-key-1", "dict-key-2"]),
          SUPABASE_SECRET_KEY: "singular",
          SUPABASE_SERVICE_ROLE_KEY: "legacy",
        }),
      ),
    ).toBe("dict-key-1");
  });

  it("falls back singular → legacy when no dict", () => {
    expect(resolveServiceRoleKey(env({ SUPABASE_SECRET_KEY: "singular" }))).toBe("singular");
    expect(resolveServiceRoleKey(env({ SUPABASE_SERVICE_ROLE_KEY: "legacy" }))).toBe("legacy");
  });

  it("returns null when no service-role key is set (never invents one)", () => {
    expect(resolveServiceRoleKey(env({}))).toBeNull();
  });

  it("does NOT read any NEXT_PUBLIC_/anon key (god-mode key must not come from a public var)", () => {
    expect(
      resolveServiceRoleKey(
        env({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_ANON_KEY: "anon2" }),
      ),
    ).toBeNull();
  });

  it("parses the {key:{value}} dict object form", () => {
    expect(
      resolveServiceRoleKey(
        env({ SUPABASE_SECRET_KEYS: JSON.stringify({ a: { value: "obj-key" } }) }),
      ),
    ).toBe("obj-key");
  });
});

describe("resolvePublishableKey", () => {
  it("prefers dict, then NEXT_PUBLIC_PUBLISHABLE, then NEXT_PUBLIC_ANON, then singular/legacy", () => {
    expect(
      resolvePublishableKey(env({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub" })),
    ).toBe("pub");
    expect(resolvePublishableKey(env({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }))).toBe("anon");
    expect(resolvePublishableKey(env({}))).toBeNull();
  });
});

describe("resolveSupabaseUrl", () => {
  it("prefers SUPABASE_URL over NEXT_PUBLIC_SUPABASE_URL; null when neither", () => {
    expect(
      resolveSupabaseUrl(
        env({ SUPABASE_URL: "https://a.supabase.co", NEXT_PUBLIC_SUPABASE_URL: "https://b.supabase.co" }),
      ),
    ).toBe("https://a.supabase.co");
    expect(resolveSupabaseUrl(env({ NEXT_PUBLIC_SUPABASE_URL: "https://b.supabase.co" }))).toBe(
      "https://b.supabase.co",
    );
    expect(resolveSupabaseUrl(env({}))).toBeNull();
  });
});
