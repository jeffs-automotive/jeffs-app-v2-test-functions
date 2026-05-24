/**
 * Unit tests for submitVehiclePickV2 — narrowed to the Plan 04 Phase 3A
 * IDOR-defense surface (closes I-COR-4).
 *
 * Surface under test:
 *   - vehicle_id === "new" → no IDOR check, advances to new_vehicle_form
 *   - existing vehicle pick:
 *       - missing customer_id on row → returns session_missing_customer_id
 *       - fetchVehiclesForCustomer SUCCESS + vehicle in list → proceeds,
 *         vehicle_id written, new_vehicle_info populated
 *       - fetchVehiclesForCustomer SUCCESS + vehicle NOT in list → IDOR
 *         reject (vehicle_id_not_owned) + Sentry warning
 *       - fetchVehiclesForCustomer FAILURE (throw) → fail-soft: proceeds
 *         without metadata or IDOR enforcement, logs warning
 *       - fetchVehiclesForCustomer result.ok=false → fail-soft same as throw
 *
 * Mocks: applyWizardTransition + fetchVehiclesForCustomer at module
 * boundary; minimal supabase mock for the customer_chat_sessions row read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Module mocks ──────────────────────────────────────────────────────────

const sentryCaptureExceptionMock: Mock = vi.fn();
const sentryCaptureMessageMock: Mock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => sentryCaptureMessageMock(...args),
  setTag: vi.fn(),
  withServerActionInstrumentation: (
    _name: string,
    _options: unknown,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

const logErrorMock: Mock = vi.fn(async () => {});
vi.mock("@/lib/scheduler/wizard/log-error", () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}));

interface AwtCall {
  chatId: string;
  nextStep: string;
  jeffBubble?: string;
  updates?: Record<string, unknown>;
}
const awtCalls: AwtCall[] = [];
vi.mock("@/lib/scheduler/wizard/transition", () => ({
  applyWizardTransition: vi.fn(async (args: AwtCall) => {
    awtCalls.push(args);
    return { ok: true, next_step: args.nextStep };
  }),
}));

interface FetchVehiclesCall {
  op: string;
  session_id: string;
  customer_id: number;
}
const fetchVehiclesCalls: FetchVehiclesCall[] = [];
type FetchResult =
  | { ok: true; vehicles: Array<{ id: number; year: number; make: string; model: string; sub_model: string | null; license_plate: string | null; color: string | null }> }
  | { ok: false; error: string };
let fetchVehiclesResult: FetchResult | (() => Promise<FetchResult>) = {
  ok: true,
  vehicles: [],
};
vi.mock("@/lib/scheduler/booking-direct-client", () => ({
  fetchVehiclesForCustomer: vi.fn(async (args: FetchVehiclesCall) => {
    fetchVehiclesCalls.push(args);
    if (typeof fetchVehiclesResult === "function") return fetchVehiclesResult();
    return fetchVehiclesResult;
  }),
  BookingDirectError: class BookingDirectError extends Error {
    status?: number;
  },
}));

// Supabase mock — only handles the row read for customer_id.
let sessionRowResult: { data: Record<string, unknown> | null; error: unknown } = {
  data: { customer_id: 9999 },
  error: null,
};
function makeMockClient() {
  return {
    from(_table: string) {
      const builder = {
        select(_cols: string) {
          return builder;
        },
        eq(_col: string, _val: unknown) {
          return builder;
        },
        async maybeSingle() {
          return sessionRowResult;
        },
      };
      return builder;
    },
  };
}
const createSupabaseAdminClientMock: Mock = vi.fn(() => makeMockClient());
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClientMock(),
}));

// Import the SUT after mocks are wired.
import { submitVehiclePickV2 } from "./submit-vehicle-pick";

// ─── Helpers ───────────────────────────────────────────────────────────────

const CHAT_ID = "00000000-0000-0000-0000-000000000001";
const CUSTOMER_ID = 9999;
const OWNED_VEHICLE_ID = 5050;
const ATTACKER_VEHICLE_ID = 7777;

function makeVehicle(id: number) {
  return {
    id,
    year: 2020,
    make: "Toyota",
    model: "Camry",
    sub_model: null,
    license_plate: "TEST123",
    color: "Silver",
  };
}

// ─── Suite ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  awtCalls.length = 0;
  fetchVehiclesCalls.length = 0;
  sessionRowResult = { data: { customer_id: CUSTOMER_ID }, error: null };
  fetchVehiclesResult = { ok: true, vehicles: [makeVehicle(OWNED_VEHICLE_ID)] };
  sentryCaptureExceptionMock.mockClear();
  sentryCaptureMessageMock.mockClear();
  logErrorMock.mockClear();
  createSupabaseAdminClientMock.mockClear();
});

describe("submitVehiclePickV2 — 'new' branch (no IDOR surface)", () => {
  it("vehicle_id='new' advances to new_vehicle_form, no fetchVehicles call", async () => {
    await submitVehiclePickV2({ chatId: CHAT_ID, vehicle_id: "new" });

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("new_vehicle_form");
    expect(fetchVehiclesCalls).toHaveLength(0);
    expect(sentryCaptureMessageMock).not.toHaveBeenCalled();
  });
});

describe("submitVehiclePickV2 — happy path (IDOR check passes)", () => {
  it("vehicle in customer's list → writes vehicle_id + new_vehicle_info, advances", async () => {
    await submitVehiclePickV2({
      chatId: CHAT_ID,
      vehicle_id: String(OWNED_VEHICLE_ID),
    });

    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("service_concern_picker");
    expect(awtCalls[0]!.updates).toMatchObject({
      vehicle_id: OWNED_VEHICLE_ID,
      new_vehicle_info: expect.objectContaining({
        year: 2020,
        make: "Toyota",
        model: "Camry",
      }),
    });
    expect(sentryCaptureMessageMock).not.toHaveBeenCalled();
  });
});

describe("submitVehiclePickV2 — IDOR defense", () => {
  it("vehicle NOT in customer's list → returns vehicle_id_not_owned + Sentry warning", async () => {
    fetchVehiclesResult = {
      ok: true,
      vehicles: [makeVehicle(OWNED_VEHICLE_ID)],
    };

    const result = await submitVehiclePickV2({
      chatId: CHAT_ID,
      vehicle_id: String(ATTACKER_VEHICLE_ID),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("vehicle_id_not_owned");
    }
    // No advance happened.
    expect(awtCalls).toHaveLength(0);

    // Sentry warning fired with the right shape.
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "vehicle_id_not_owned_by_customer",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          surface: "submit_vehicle_pick_v2_idor",
          chat_id: CHAT_ID,
        }),
        extra: expect.objectContaining({
          customer_id: CUSTOMER_ID,
          attempted_vehicle_id: ATTACKER_VEHICLE_ID,
          owned_vehicle_count: 1,
        }),
      }),
    );
  });

  it("empty vehicle list → returns vehicle_id_not_owned", async () => {
    fetchVehiclesResult = { ok: true, vehicles: [] };

    const result = await submitVehiclePickV2({
      chatId: CHAT_ID,
      vehicle_id: String(OWNED_VEHICLE_ID),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("vehicle_id_not_owned");
    }
    expect(awtCalls).toHaveLength(0);
  });
});

describe("submitVehiclePickV2 — fail-soft on fetch failures", () => {
  it("fetch throws → advances without metadata or IDOR enforcement, logs warning", async () => {
    fetchVehiclesResult = async () => {
      throw new Error("Tekmetric 503 transient");
    };

    await submitVehiclePickV2({
      chatId: CHAT_ID,
      vehicle_id: String(ATTACKER_VEHICLE_ID),
    });

    // Action advances (fail-soft policy).
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("service_concern_picker");
    expect(awtCalls[0]!.updates).toMatchObject({
      vehicle_id: ATTACKER_VEHICLE_ID,
    });
    // No new_vehicle_info since fetch failed.
    expect(awtCalls[0]!.updates).not.toHaveProperty("new_vehicle_info");

    // Sentry captureException fired at warning level.
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    const [, ctx] = sentryCaptureExceptionMock.mock.calls[0]!;
    expect((ctx as { level?: string }).level).toBe("warning");
  });

  it("fetch returns ok:false → advances without metadata or IDOR enforcement", async () => {
    fetchVehiclesResult = { ok: false, error: "tekmetric_500" };

    await submitVehiclePickV2({
      chatId: CHAT_ID,
      vehicle_id: String(ATTACKER_VEHICLE_ID),
    });

    // Action advances (fail-soft policy mirrors the throw case).
    expect(awtCalls).toHaveLength(1);
    expect(awtCalls[0]!.nextStep).toBe("service_concern_picker");
    expect(awtCalls[0]!.updates).not.toHaveProperty("new_vehicle_info");
    // No IDOR warning since we couldn't verify ownership either way.
    expect(sentryCaptureMessageMock).not.toHaveBeenCalledWith(
      "vehicle_id_not_owned_by_customer",
      expect.anything(),
    );
  });
});

describe("submitVehiclePickV2 — data integrity (missing customer_id)", () => {
  it("row has no customer_id → returns session_missing_customer_id, no fetch, no advance", async () => {
    sessionRowResult = { data: { customer_id: null }, error: null };

    const result = await submitVehiclePickV2({
      chatId: CHAT_ID,
      vehicle_id: String(OWNED_VEHICLE_ID),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("session_missing_customer_id");
    }
    expect(fetchVehiclesCalls).toHaveLength(0);
    expect(awtCalls).toHaveLength(0);
    expect(sentryCaptureMessageMock).toHaveBeenCalledWith(
      "vehicle_pick_missing_customer_id",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          surface: "submit_vehicle_pick_v2_missing_customer_id",
        }),
      }),
    );
  });

  it("row is null entirely → returns session_missing_customer_id", async () => {
    sessionRowResult = { data: null, error: null };

    const result = await submitVehiclePickV2({
      chatId: CHAT_ID,
      vehicle_id: String(OWNED_VEHICLE_ID),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("session_missing_customer_id");
    }
  });
});
