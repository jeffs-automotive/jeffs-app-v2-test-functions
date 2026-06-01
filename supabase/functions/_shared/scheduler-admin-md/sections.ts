// sections — scheduler admin MD module.
// Extracted from scheduler-admin-md.ts (file-size-refactor). Mechanical split
// — no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { computeConfirmToken, computeCanonicalAfterState, canonicalizeDiff } from "./canonical-state.ts";
import { logAuditEntry } from "./audit.ts";

export interface ParsedMdSection {
  /** The service_key from the `## heading`. */
  key: string;
  /** Raw field map, keys lowercased + spaces→underscores. */
  fields: Record<string, string>;
  /** Source line number of the heading (1-indexed) for error messages. */
  heading_line: number;
}

export interface ParsedMdSections {
  /** Title from the H1, or empty if absent. */
  title: string;
  sections: ParsedMdSection[];
}

/**
 * Parse an MD file in the Option B per-service-block format. Returns sections
 * keyed by their `## heading` (the service_key). Field names are normalized
 * (lowercase + spaces→underscores) but values are kept as raw trimmed strings
 * — value parsing (price → cents, csv → array, etc.) is the caller's job.
 *
 * Throws on:
 *   - Duplicate `## heading` (same service_key twice)
 *   - Malformed field line (no `:` separator)
 *   - service_key not matching ^[a-z0-9_]+$
 */
export function parseMdSections(md: string): ParsedMdSections {
  const lines = md.split(/\r?\n/);
  let title = "";
  const sections: ParsedMdSection[] = [];
  const seenKeys = new Set<string>();
  let current: ParsedMdSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const lineNo = i + 1;

    if (line === "" || line.startsWith("---")) {
      continue;
    }

    // HTML comments — handle BOTH single-line (`<!-- ... -->` on one line) AND
    // multi-line (open `<!--` here, closing `-->` on a later line). Walks past
    // intermediate lines so they don't get mis-parsed as Field lines. Without
    // this, a between-section multi-line comment like:
    //   <!-- ====
    //        BANNER
    //   ==== -->
    // would skip the `<!--` line, then choke on the BANNER line as a Field.
    if (line.startsWith("<!--")) {
      if (line.includes("-->")) {
        continue; // single-line comment closed on same line
      }
      let j = i + 1;
      while (j < lines.length && !lines[j].includes("-->")) j++;
      i = j; // jump past the closing line
      continue;
    }

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      title = line.slice(2).trim();
      continue;
    }

    if (line.startsWith("## ")) {
      const key = line.slice(3).trim();
      if (!/^[a-z0-9_]+$/.test(key)) {
        throw new Error(
          `line ${lineNo}: service_key "${key}" must match ^[a-z0-9_]+$ (lowercase + digits + underscores only)`,
        );
      }
      if (seenKeys.has(key)) {
        throw new Error(
          `line ${lineNo}: duplicate service_key "${key}" (already defined earlier in the file)`,
        );
      }
      seenKeys.add(key);
      current = { key, fields: {}, heading_line: lineNo };
      sections.push(current);
      continue;
    }

    // Field line — must be under a section
    if (!current) {
      // Bare text outside a section — skip (could be intro prose under H1)
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) {
      throw new Error(
        `line ${lineNo}: expected "Field: value" inside section "${current.key}"; got "${line}"`,
      );
    }
    const fieldName = line.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, "_");
    const fieldValue = line.slice(colonIdx + 1).trim();
    current.fields[fieldName] = fieldValue;
  }

  return { title, sections };
}

// ─── Field value parsers (helpers callers can use) ──────────────────────

/**
 * Parse a price expression to cents (integer ≥ 0) or null.
 * Accepts: "$49.95", "49.95", "4995", "Free", "free", "(none)", "" → null, "0" → 0.
 * Throws on garbage.
 */
export function parsePriceCents(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (s === "" || /^\(?none\)?$/i.test(s)) return null;
  if (/^free$/i.test(s)) return 0;
  // Dollar form: $X.XX or $X
  const dollarMatch = s.match(/^\$?\s*(\d+)(?:\.(\d{1,2}))?\s*$/);
  if (dollarMatch) {
    const dollars = parseInt(dollarMatch[1], 10);
    const centsRaw = dollarMatch[2] ?? "0";
    const cents = parseInt(centsRaw.padEnd(2, "0"), 10);
    return dollars * 100 + cents;
  }
  throw new Error(
    `invalid price "${raw}" — expected "$XX.XX", "XX.XX", "Free", or "(none)"`,
  );
}

/**
 * Format cents as "$XX.XX" or "Free" or "(none)".
 */
export function formatPriceCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "(none)";
  if (cents === 0) return "Free";
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `$${dollars}.${remainder.toString().padStart(2, "0")}`;
}

/**
 * Parse a CSV-or-bullet-separated list into a trimmed string array.
 * Accepts "a, b, c" or "a · b · c" or "a; b; c". Empty → [].
 */
export function parseCsvList(raw: string | undefined): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (s === "" || s === "(none)") return [];
  return s.split(/\s*[,·;]\s*/).map((x) => x.trim()).filter(Boolean);
}

/**
 * Parse "true"/"false"/"yes"/"no"/"1"/"0" to boolean. Throws on garbage.
 */
export function parseBool(raw: string | undefined, fieldName = "field"): boolean {
  if (raw === undefined) {
    throw new Error(`${fieldName}: missing value`);
  }
  const s = raw.trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1") return true;
  if (s === "false" || s === "no" || s === "0") return false;
  throw new Error(`${fieldName}: expected true/false/yes/no/1/0, got "${raw}"`);
}

/**
 * Parse an integer. Throws on garbage.
 */
export function parseIntField(raw: string | undefined, fieldName = "field"): number {
  if (raw === undefined) {
    throw new Error(`${fieldName}: missing value`);
  }
  const s = raw.trim();
  const n = parseInt(s, 10);
  if (!/^-?\d+$/.test(s) || Number.isNaN(n)) {
    throw new Error(`${fieldName}: expected integer, got "${raw}"`);
  }
  return n;
}

/**
 * Parse a string field — empty → null, otherwise trimmed string.
 */
export function parseStringField(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (s === "" || s === "(none)") return null;
  return s;
}

// ─── Serializer ─────────────────────────────────────────────────────────

export interface SectionSpec {
  /** The H1 title. */
  title: string;
  /** Multi-line HTML comment shown above the first section as advisor guidance. */
  guidance?: string;
  /** Ordered field list — Field display name (e.g. "Display name") + serializer. */
  fields: Array<{
    label: string;
    /** Read the value from the row + return the string to render after "Label: ". */
    get: (row: Record<string, unknown>) => string;
  }>;
}

/**
 * Render an array of rows into the Option B per-service-block MD format.
 * `keyField` is the column name that becomes the `## heading`.
 */
export function serializeMdSections(
  rows: Record<string, unknown>[],
  keyField: string,
  spec: SectionSpec,
): string {
  const out: string[] = [];
  out.push(`# ${spec.title}`);
  out.push("");
  if (spec.guidance) {
    out.push("<!--");
    out.push(spec.guidance);
    out.push("-->");
    out.push("");
  }
  const sorted = [...rows].sort((a, b) => {
    const ak = String(a[keyField] ?? "");
    const bk = String(b[keyField] ?? "");
    return ak.localeCompare(bk);
  });
  for (const row of sorted) {
    const key = String(row[keyField] ?? "");
    out.push(`## ${key}`);
    for (const field of spec.fields) {
      const value = field.get(row);
      out.push(`${field.label}: ${value}`);
    }
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

// ═══════════════════════════════════════════════════════════════════════════
// scheduler-edge-parity E2 — Shared helpers for Pattern S + revert dispatch
// ═══════════════════════════════════════════════════════════════════════════
//
// Authored 2026-05-26 per PLAN.md §4.8 + ROUND-6-RESIDUALS E1cf-N2 +
// ADR-025 (pipe-delimited canonical state format).
//
// 4 exported helpers:
//   1. computeConfirmToken(args)         — Pattern S deterministic token
//                                          (mirrors plpgsql formula per E1cf-N2)
//   2. computeCanonicalAfterState(args)  — 10 kind handlers emitting the
//                                          pipe-delimited canonical format per
//                                          ADR-025, byte-for-byte matching
//                                          `canonical_state_<kind>` plpgsql in
//                                          migration 20260526000100.
//   3. canonicalizeDiff(diffSummary)     — stable JSON canonicalization
//                                          (sorted object keys + allow-list
//                                          set-typed array sorting).
//   4. logAuditEntry(args)               — consolidated audit-row INSERT helper.
//                                          REQUIRES shopId (closes prior NULL
//                                          shop_id footgun — see Migration A).
//
// Import dependency: SupabaseClient from npm:@supabase/supabase-js@2 — same
// specifier the 22 other _shared/ + _shared/tools/ files use. The original
// E2 author's jsr: specifier produced "Property 'supabaseUrl' is protected"
// errors at every call site (npm/jsr give nominally-distinct types from
// Deno's perspective), discovered during E4 retrofit 2026-05-26.
// ═══════════════════════════════════════════════════════════════════════════
