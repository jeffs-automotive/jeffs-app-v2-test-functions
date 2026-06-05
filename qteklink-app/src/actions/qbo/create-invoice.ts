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

import { requireQtekUser } from "@/lib/auth";
import { wrapQtekAction } from "@/lib/instrument-action";
import { QboClient } from "@/lib/qbo/client";
import { invoiceSchema } from "@/lib/qbo/entities";
import { qboFailure, type QboActionResult } from "./result";

async function createInvoiceImpl(
  input: z.infer<typeof invoiceSchema>,
): Promise<QboActionResult<unknown>> {
  await requireQtekUser();
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "validation",
      message: parsed.error.issues.map((i) => i.message).join("; "),
      timestamp: Date.now(),
    };
  }
  try {
    const data = await new QboClient().create("Invoice", parsed.data);
    return { ok: true, data, timestamp: Date.now() };
  } catch (e) {
    return qboFailure(e);
  }
}

export const createInvoiceAction = wrapQtekAction(
  "qboCreateInvoice",
  createInvoiceImpl,
);
