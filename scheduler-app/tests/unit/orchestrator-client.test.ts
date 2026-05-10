import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  consultOrchestrator,
  OrchestratorError,
  resolveServiceRoleKey,
} from "@/lib/scheduler/orchestrator-client";

describe("consultOrchestrator", () => {
  const originalEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.ORCHESTRATOR_URL =
      "https://test-project.supabase.co/functions/v1/orchestrator-direct";
    // Clear all 3 secret-env names + start with the canonical 2026 plural form
    delete process.env.SUPABASE_SECRET_KEYS;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test_key";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fetchSpy.mockRestore();
  });

  it("POSTs to ORCHESTRATOR_URL with Bearer + apikey headers + JSON body", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          directive: "show_phone_entry",
          flags: { customer_status: "not_found" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const out = await consultOrchestrator({
      session_id: "sess-1",
      context: "Customer wants oil change",
      hints: { phone_e164: "+16105550123" },
    });

    expect(out).toEqual({
      directive: "show_phone_entry",
      flags: { customer_status: "not_found" },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      "https://test-project.supabase.co/functions/v1/orchestrator-direct",
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sb_secret_test_key");
    expect(headers.apikey).toBe("sb_secret_test_key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      session_id: "sess-1",
      context: "Customer wants oil change",
      hints: { phone_e164: "+16105550123" },
    });
  });

  it("throws OrchestratorError on non-2xx response with status set", async () => {
    fetchSpy.mockResolvedValue(
      new Response("internal server error", { status: 500 }),
    );

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toMatchObject({
      name: "OrchestratorError",
      status: 500,
    });
  });

  it("throws OrchestratorError on missing ORCHESTRATOR_URL env", async () => {
    delete process.env.ORCHESTRATOR_URL;

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toThrow(/ORCHESTRATOR_URL/);
  });

  it("throws OrchestratorError when no service-role bearer env is set", async () => {
    delete process.env.SUPABASE_SECRET_KEYS;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toThrow(/service-role bearer/);
  });

  it("throws OrchestratorError on network failure (fetch rejects)", async () => {
    fetchSpy.mockRejectedValue(new Error("connection refused"));

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toMatchObject({
      name: "OrchestratorError",
      message: expect.stringMatching(/Network error/),
    });
  });

  it("throws OrchestratorError when response body is not JSON", async () => {
    fetchSpy.mockResolvedValue(
      new Response("<html>oops</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toThrow(/non-JSON body/);
  });

  it("throws OrchestratorError when response is JSON but missing `directive`", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: "no directive" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      consultOrchestrator({ session_id: "x", context: "y" }),
    ).rejects.toThrow(/missing required `directive`/);
  });

  it("OrchestratorError is an instance of Error + has correct name", () => {
    const e = new OrchestratorError("test", 502);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("OrchestratorError");
    expect(e.status).toBe(502);
  });

  describe("resolveServiceRoleKey (2026 env-naming resolver)", () => {
    it("prefers SUPABASE_SECRET_KEYS (JSON dict) over singular envs", () => {
      const env = {
        SUPABASE_SECRET_KEYS: JSON.stringify({
          service_role: "sb_secret_FROM_DICT",
        }),
        SUPABASE_SECRET_KEY: "sb_secret_FROM_SINGULAR",
        SUPABASE_SERVICE_ROLE_KEY: "legacy_jwt_value",
      } as unknown as NodeJS.ProcessEnv;
      expect(resolveServiceRoleKey(env)).toBe("sb_secret_FROM_DICT");
    });

    it("parses a SUPABASE_SECRET_KEYS array of strings", () => {
      const env = {
        SUPABASE_SECRET_KEYS: JSON.stringify([
          "sb_secret_A",
          "sb_secret_B",
        ]),
      } as unknown as NodeJS.ProcessEnv;
      expect(resolveServiceRoleKey(env)).toBe("sb_secret_A");
    });

    it("parses a SUPABASE_SECRET_KEYS array of {value} objects", () => {
      const env = {
        SUPABASE_SECRET_KEYS: JSON.stringify([
          { name: "service_role", value: "sb_secret_FROM_ARRAY_VALUE" },
        ]),
      } as unknown as NodeJS.ProcessEnv;
      expect(resolveServiceRoleKey(env)).toBe("sb_secret_FROM_ARRAY_VALUE");
    });

    it("falls back to SUPABASE_SECRET_KEY when dict is missing", () => {
      const env = {
        SUPABASE_SECRET_KEY: "sb_secret_FROM_SINGULAR",
      } as unknown as NodeJS.ProcessEnv;
      expect(resolveServiceRoleKey(env)).toBe("sb_secret_FROM_SINGULAR");
    });

    it("falls back to SUPABASE_SERVICE_ROLE_KEY as last resort", () => {
      const env = {
        SUPABASE_SERVICE_ROLE_KEY: "legacy_jwt_value",
      } as unknown as NodeJS.ProcessEnv;
      expect(resolveServiceRoleKey(env)).toBe("legacy_jwt_value");
    });

    it("returns null when no env is set", () => {
      expect(resolveServiceRoleKey({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    });

    it("falls through to singular envs when SUPABASE_SECRET_KEYS is unparseable", () => {
      const env = {
        SUPABASE_SECRET_KEYS: "not-json-{",
        SUPABASE_SECRET_KEY: "sb_secret_FALLBACK",
      } as unknown as NodeJS.ProcessEnv;
      expect(resolveServiceRoleKey(env)).toBe("sb_secret_FALLBACK");
    });
  });

  it("does not include hints in body when not provided", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ directive: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await consultOrchestrator({ session_id: "s", context: "c" });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ session_id: "s", context: "c" });
    expect(body.hints).toBeUndefined();
  });
});
