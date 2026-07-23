/**
 * Unit tests for booking-direct-client.ts URL validation.
 *
 * Plan 04 post-validator P0.3 fix (2026-05-25):
 *
 * The booking-direct endpoint URL is derived from ORCHESTRATOR_URL +
 * validated against NEXT_PUBLIC_SUPABASE_URL. The validation has two
 * layers — both must pass before any fetch() with the service-role
 * bearer can run:
 *
 *   1. Derived host MUST end with `.supabase.co` (hardcoded suffix —
 *      no env-tampering can leak the key to evil.com).
 *   2. Derived host MUST exactly match NEXT_PUBLIC_SUPABASE_URL's host
 *      (env vars must agree on which Supabase project they target).
 *
 * Tests assert both layers fail-closed on bad env config.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { _bookingDirectUrl, BookingDirectError } from "./booking-direct-client";

const ORIG_ORCHESTRATOR = process.env.ORCHESTRATOR_URL;
const ORIG_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;

afterEach(() => {
  // Restore to whatever the test runner started with (typically undefined).
  if (ORIG_ORCHESTRATOR === undefined) delete process.env.ORCHESTRATOR_URL;
  else process.env.ORCHESTRATOR_URL = ORIG_ORCHESTRATOR;
  if (ORIG_SUPABASE === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG_SUPABASE;
});

describe("bookingDirectUrl — P0.3 host validation", () => {
  it("happy path: matching project host → returns derived URL", () => {
    process.env.ORCHESTRATOR_URL =
      "https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/orchestrator";
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://itzdasxobllfiuolmbxu.supabase.co";

    const url = _bookingDirectUrl();

    expect(url).toBe(
      "https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/scheduler-booking-direct",
    );
  });

  it("Layer 1 (suffix gate): non-supabase.co host → throws BookingDirectError", () => {
    // Attacker-set ORCHESTRATOR_URL pointing to evil.com.
    process.env.ORCHESTRATOR_URL =
      "https://evil.example.com/functions/v1/orchestrator";
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://evil.example.com";

    expect(() => _bookingDirectUrl()).toThrow(BookingDirectError);
    expect(() => _bookingDirectUrl()).toThrow(/does not end with '\.supabase\.co'/);
  });

  it("Layer 2 (cross-env match): supabase.co host but different project → throws", () => {
    process.env.ORCHESTRATOR_URL =
      "https://OTHERPROJECT.supabase.co/functions/v1/orchestrator";
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://itzdasxobllfiuolmbxu.supabase.co";

    expect(() => _bookingDirectUrl()).toThrow(BookingDirectError);
    expect(() => _bookingDirectUrl()).toThrow(/does not match NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("missing ORCHESTRATOR_URL → throws with clear message", () => {
    delete process.env.ORCHESTRATOR_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://itzdasxobllfiuolmbxu.supabase.co";

    expect(() => _bookingDirectUrl()).toThrow(/Missing ORCHESTRATOR_URL/);
  });

  it("missing NEXT_PUBLIC_SUPABASE_URL → throws AFTER suffix gate passes", () => {
    process.env.ORCHESTRATOR_URL =
      "https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/orchestrator";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    expect(() => _bookingDirectUrl()).toThrow(
      /Missing NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it("malformed ORCHESTRATOR_URL → throws with derivation context", () => {
    process.env.ORCHESTRATOR_URL = "not-a-valid-url";
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://itzdasxobllfiuolmbxu.supabase.co";

    expect(() => _bookingDirectUrl()).toThrow(BookingDirectError);
  });

  it("derived path swaps the trailing segment to scheduler-booking-direct", () => {
    process.env.ORCHESTRATOR_URL =
      "https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/anything-else";
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://itzdasxobllfiuolmbxu.supabase.co";

    const url = _bookingDirectUrl();

    expect(url).toBe(
      "https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/scheduler-booking-direct",
    );
  });
});
