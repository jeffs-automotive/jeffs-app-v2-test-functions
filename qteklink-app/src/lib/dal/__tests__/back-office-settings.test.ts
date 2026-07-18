/**
 * Unit tests for the back-office settings DAL — specifically the new reopened-RO alert
 * recipient list (reopenedEmails) round-tripping through the blob. Mocks the admin client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));
vi.mock("@/lib/dal/realm", () => ({
  resolveRealmForShop: vi.fn(() => Promise.resolve("realm-A")),
}));

import { getBackOfficeSettings, upsertBackOfficeSettings, DEFAULT_BACK_OFFICE_SETTINGS } from "../back-office";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "limit"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getBackOfficeSettings", () => {
  it("maps reopened_emails into reopenedEmails", async () => {
    fromMock.mockReturnValue(
      chain({
        data: [{
          back_office: {
            sa_emails: ["sa@shop.com"],
            office_emails: ["office@shop.com"],
            accounting_emails: ["acct@shop.com"],
            reopened_emails: ["reopen1@shop.com", "reopen2@shop.com"],
            digest_emails: ["digest@shop.com"],
            fallback_admin_email: "admin@shop.com",
            stale_hours: 24,
          },
        }],
        error: null,
      }),
    );
    const { settings } = await getBackOfficeSettings(7476);
    expect(settings.reopenedEmails).toEqual(["reopen1@shop.com", "reopen2@shop.com"]);
  });

  it("defaults reopenedEmails to [] when the blob omits it", async () => {
    fromMock.mockReturnValue(chain({ data: [{ back_office: { office_emails: ["office@shop.com"] } }], error: null }));
    const { settings } = await getBackOfficeSettings(7476);
    expect(settings.reopenedEmails).toEqual([]);
  });

  it("returns the DEFAULTS (incl. empty reopenedEmails) when there is no row", async () => {
    fromMock.mockReturnValue(chain({ data: [], error: null }));
    const { settings } = await getBackOfficeSettings(7476);
    expect(settings).toEqual(DEFAULT_BACK_OFFICE_SETTINGS);
    expect(settings.reopenedEmails).toEqual([]);
  });
});

describe("upsertBackOfficeSettings", () => {
  it("writes reopened_emails into the blob", async () => {
    rpcMock.mockResolvedValue({ error: null });
    await upsertBackOfficeSettings(7476, {
      ...DEFAULT_BACK_OFFICE_SETTINGS,
      reopenedEmails: ["reopen@shop.com"],
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "back_office_upsert_settings",
      expect.objectContaining({
        p_back_office: expect.objectContaining({ reopened_emails: ["reopen@shop.com"] }),
      }),
    );
  });
});
