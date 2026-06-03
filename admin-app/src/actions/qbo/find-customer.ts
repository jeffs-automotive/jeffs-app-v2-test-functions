"use server";

/**
 * findCustomerAction — query QBO Customers by exact DisplayName (read).
 * Demonstrates the query() path. The DisplayName is escaped before being
 * interpolated into the QBL string literal (QBO QBL has no bind params).
 */
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { QboClient } from "@/lib/qbo/client";
import { qboFailure, type QboActionResult } from "./result";

const inputSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
});

/** Escape a value for a QBL single-quoted string literal (backslash, then quote). */
function escapeQbl(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findCustomerImpl(
  input: z.infer<typeof inputSchema>,
): Promise<QboActionResult<unknown>> {
  await requireAdmin();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    const qbl = `SELECT * FROM Customer WHERE DisplayName = '${escapeQbl(parsed.data.displayName)}'`;
    const data = await new QboClient().query(qbl);
    return { ok: true, data };
  } catch (e) {
    return qboFailure(e);
  }
}

export const findCustomerAction = wrapAdminAction(
  "qboFindCustomer",
  findCustomerImpl,
);
