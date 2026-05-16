/**
 * /book-v2 — deprecated migration route (Phase 15 redirect).
 *
 * The server-state-driven wizard now lives at / and /book per the
 * Phase 15 cutover (2026-05-16). This route stays as a redirect so any
 * advisor-shared /book-v2 links + Vercel preview deployments from the
 * migration window continue to work. Phase 16 deletes this route
 * entirely + cleans up the legacy AI-SDK dependency tree.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function BookV2Page() {
  redirect("/book");
}
