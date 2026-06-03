"use server";

/**
 * createInvoiceAction — create an Invoice on the connected QBO company (WRITE).
 *
 * ⚠️ Writes against the REAL Jeff's Automotive books. Per plan decision #6, the
 * FIRST live write is a HUMAN GATE: this action is deployed but only mutates
 * accounting data when explicitly invoked with Chris's go-ahead. The client
 * adds an idempotent `requestid` (held constant across retries) so a
 * 5xx-then-success can't double-post.
 */
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { wrapAdminAction } from "@/lib/instrument-action";
import { QboClient } from "@/lib/qbo/client";
import { invoiceSchema } from "@/lib/qbo/entities";
import { qboFailure, type QboActionResult } from "./result";

async function createInvoiceImpl(
  input: z.infer<typeof invoiceSchema>,
): Promise<QboActionResult<unknown>> {
  await requireAdmin();
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  try {
    const data = await new QboClient().create("Invoice", parsed.data);
    return { ok: true, data };
  } catch (e) {
    return qboFailure(e);
  }
}

export const createInvoiceAction = wrapAdminAction(
  "qboCreateInvoice",
  createInvoiceImpl,
);
