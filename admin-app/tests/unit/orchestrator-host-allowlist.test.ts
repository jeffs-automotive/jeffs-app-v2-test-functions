import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Sentry SDK so importing the client doesn't pull the full @sentry/nextjs
// runtime into the test (the throw paths below never reach a Sentry call anyway).
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { callKeytagTool, OrchestratorClientError } from "@/lib/orchestrator/client";

/**
 * service-role-host-allowlist invariant: the orchestrator client builds its URL
 * from the configured Supabase URL and must FAIL-CLOSED — throwing BEFORE any
 * fetch — if the derived host doesn't end with `.supabase.co`. That gate is the
 * one thing standing between a typo'd/cross-project env var and exfiltrating the
 * SERVICE_ROLE bearer to an arbitrary host.
 */
describe("orchestrator client host-allowlist (service-role-host-allowlist)", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    fetchSpy.mockReset();
    // A service-role key is present so the only thing under test is the host gate.
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-service-role-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses to send the bearer to a non-.supabase.co host (throws before fetch)", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://evil.example.com");

    await expect(
      callKeytagTool("listWipKeyTags", {}, "chris@jeffsautomotive.com"),
    ).rejects.toBeInstanceOf(OrchestratorClientError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when no Supabase URL is configured (no bearer sent)", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    await expect(
      callKeytagTool("listWipKeyTags", {}, "chris@jeffsautomotive.com"),
    ).rejects.toBeInstanceOf(OrchestratorClientError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a lookalike host that merely CONTAINS supabase.co (must END with it)", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.co.evil.com");

    await expect(
      callKeytagTool("listWipKeyTags", {}, "chris@jeffsautomotive.com"),
    ).rejects.toBeInstanceOf(OrchestratorClientError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
