# Research 02 — Missing MD Exporters for `concern_category_guidelines` + `concern_subcategories`

**Feature:** `scheduler-edge-parity`
**Scope:** Design 2 missing MD exporters so every uploader on the orchestrator-mcp surface has an export → edit → re-upload round-trip path. Blockers B1 (concern_category_guidelines) + B2 (concern_subcategories disambiguation) from `.claude/work/ai-review-2026-05-25T22-40-58Z.md`.
**Authored:** 2026-05-25 via Explore sub-agent (Opus). Content returned inline by the agent + transcribed verbatim.

---

## Q1. What does `export_concern_questions_md` actually export today?

**Implementation:** `exportConcernQuestionsMd` at `supabase/functions/_shared/tools/scheduler-admin.ts:1094-1119`.

It queries **only** `concern_questions` and serializes via the legacy `mdTableFromRows` helper (single wide table):

```ts
sb.from("concern_questions")
  .select("category, question_text, options, display_order, active")
  .eq("shop_id", shopId)
  .order("category", { ascending: true })
  .order("display_order", { ascending: true });
```

**Coverage:**
- Covers `concern_questions` only.
- **Does NOT** cover `concern_subcategories` — no join, no subcategory column in the select list.
- **Does NOT** include `subcategory_id` (the FK introduced at `supabase/migrations/20260514100000_scheduler_concern_subcategories_and_keywords.sql:99-100`), so the export is lossy for the Phase 9b+ hierarchical model — subcategory linkage is silently flattened to category only.
- **Does NOT** include `multi_select` (column added in same migration era; tracked in `ConcernQuestionRow` at `scheduler-admin.ts:1789`).
- **Does NOT** round-trip cleanly through `uploadConcernCategoryMd` (which expects the hierarchical `# Category` + `-- Sub-Category Checklist --` shape parsed at `scheduler-admin-md.ts:506`). It only round-trips through the legacy `uploadConcernQuestionsMd` (`scheduler-admin.ts:796`), which itself is flagged LEGACY in the tool description at `scheduler-tools.ts:1196`.

**Conclusion for B2:** `export_concern_questions_md` does NOT cover the sub-categories surface. The ambiguity in the research artifact resolves to "neither table fully" — it's a flat table export of one column slice. A dedicated subcategory exporter is required.

---

## Q2. What columns does `concern_category_guidelines` have?

**Migration:** `supabase/migrations/20260514000000_scheduler_concern_category_guidelines.sql:25-49`.

| Column | Type | Notes |
| --- | --- | --- |
| `shop_id` | `INTEGER NOT NULL` | Part of PK |
| `category` | `TEXT NOT NULL` | CHECK constraint enumerates the 14 slugs (lines 27-42); part of PK |
| `display_label` | `TEXT NOT NULL` | Human-readable label, round-trips through `parseConcernCategoryGuidelineMd` |
| `guideline_prose` | `TEXT NOT NULL` | The body content |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Audit metadata |
| `updated_by_oauth_client_id` | `TEXT` | Audit metadata |
| `updated_by_name` | `TEXT` | Audit metadata |
| PRIMARY KEY | `(shop_id, category)` | One row per (shop, category) |

The 14-slug whitelist matches the `CONCERN_CATEGORY_SLUGS` constant at `scheduler-admin.ts:1751-1766`. RLS `deny_all` requires service-role for any access (line 52).

---

## Q3. What MD format does `uploadConcernCategoryGuidelineMd` parse?

**Uploader:** `uploadConcernCategoryGuidelineMd` at `scheduler-admin.ts:2210-2408` (validates slug → parses → fetches existing → INSERT or UPDATE).

**Parser:** `parseConcernCategoryGuidelineMd` at `scheduler-admin-md.ts:449-504`.

**Structural shape — per-category single-doc** (NOT a table, NOT front-matter):

```
# {Display Label} — Diagnostic Guideline

{Prose paragraph(s). Can span multiple paragraphs; blank lines preserved as
single newlines via the lastBlank toggle on lines 481-491.}

---

{Optional notes / sources — IGNORED below the first `---` HR}
```

Parser contract that the exporter must satisfy for round-trip:

1. **First non-blank line MUST be an H1** matched against `/^#\s+(.+?)\s*$/` (line 461).
2. Parser **strips the trailing `" — Diagnostic Guideline"` suffix** if present (line 469) — so the exporter should emit `# {display_label} — Diagnostic Guideline` and the parser will store `display_label` without the suffix.
3. **Prose body is collected non-blank-trimmed; consecutive blank lines collapse to one** (`lastBlank` logic, lines 481-491). Trailing blanks are popped (lines 493-495).
4. **Empty prose throws** (`"empty prose body"`, line 498).
5. **First `---` HR terminates** parsing (lines 453-454).
6. One doc = one (shop_id, category) row.

---

## Q4. What MD format does `uploadConcernCategoryMd` parse?

**Uploader:** `uploadConcernCategoryMd` at `scheduler-admin.ts:1792-2190` — handles BOTH `concern_subcategories` (UPSERT) AND `concern_questions` (UPSERT + soft-delete) in one transaction-ish flow per category.

**Parser:** `parseConcernCategoryMd` at `scheduler-admin-md.ts:506-701`. Output shape per `ParsedConcernDoc` (line 399-402):

```ts
{ display_label: string, subcategories: ParsedConcernSubcategory[] }
// where ParsedConcernSubcategory (line 392-397):
{ slug, display_label, display_order, questions: ParsedConcernQuestion[] }
// where ParsedConcernQuestion (line 375-390):
{ question_text, display_order, options?, multi_select? }
```

**Structural shape — per-category hierarchical doc:**

```
# {Category Display Label}

-- {Sub-Category Name 1} Checklist --
1. First question text
   - Yes | No | Maybe
2. [multi] Multi-select question
   - opt1=value1 | opt2=value2

-- {Sub-Category Name 2} Checklist --
1. ...

---

{Sources / notes — ignored}
```

Parser contract for the exporter:

1. **First non-blank line MUST be H1** (line 523) → category display label.
2. **Sub-category headers** match `/^--\s+(.+?)\s+Checklist\s+--\s*$/` (line 542). Empty sub-cat names throw (line 583).
3. **Subcategory slugs** are generated by `slugifyForConcernSubcategory(label)` (line 586, defined at `scheduler-admin-md.ts:409-415`) — lowercased, non-alnum→`_`, capped at 80 chars. The exporter MUST emit the original `display_label` (NOT the slug) so the parser regenerates the same slug.
4. **Numbered questions** match `/^(\d+)\.\s+(.+?)\s*$/` (line 543). Number IS NOT stored — `display_order` is derived from position within sub-category (`nextQuestionOrder`, line 540).
5. **Multi-select prefix** `[multi] ` is stripped and sets `multi_select=true` (lines 610-615).
6. **Options line** matches indented `\s+-\s+(.+)` (line 548), pipe-separated entries with optional `Label=value` syntax (lines 633-668). If no `=`, value is slugified from label.
7. **`---` HR terminates** parsing (lines 512-515).
8. **Each subcategory MUST have ≥1 question** else throws (lines 691-694).
9. **`concern_questions.category` stays in sync** with `concern_subcategories.category` (denormalized — see migration line 14-17).

---

## Q5. Design `exportConcernCategoryGuidelineMd`

### Signature

Place in `supabase/functions/_shared/tools/scheduler-admin.ts` (same file as the uploader). One exporter call serializes ONE category's guideline, mirroring the per-category uploader scope.

```ts
export async function exportConcernCategoryGuidelineMd(
  sb: SupabaseClient,
  shopId: number,
  args: { category_slug: string },
): Promise<{ md_content: string; row_count: number }> {
  if (!CONCERN_CATEGORY_SLUGS.includes(args.category_slug as ConcernCategorySlug)) {
    throw new Error(
      `category_slug must be one of: ${CONCERN_CATEGORY_SLUGS.join(", ")}`,
    );
  }
  const categorySlug = args.category_slug as ConcernCategorySlug;

  const { data, error } = await sb
    .from("concern_category_guidelines")
    .select("display_label, guideline_prose")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .maybeSingle();
  if (error) {
    throw new Error(`concern_category_guidelines export failed: ${error.message}`);
  }
  if (!data) {
    // Empty doc — round-trips through parser only if non-empty. Surface a
    // not-yet-seeded sentinel for the admin UI rather than emitting invalid MD.
    return { md_content: "", row_count: 0 };
  }

  const md = [
    `# ${data.display_label} — Diagnostic Guideline`,
    "",
    data.guideline_prose,
    "",
    "---",
    "",
    `<!-- exported from concern_category_guidelines (shop_id=${shopId}, category=${categorySlug}) -->`,
    "",
  ].join("\n");

  return { md_content: md, row_count: 1 };
}
```

### Example output (category `warning_light`)

```md
# Warning light — Diagnostic Guideline

For warning lights we need: WHICH LIGHT (check engine, ABS, airbag, oil pressure, temperature, battery, TPMS — customers can usually identify by color or shape), BEHAVIOR (steady on, flashing, comes and goes), HOW THE CAR IS DRIVING (normally, sluggish, hesitating, stalling), and any OTHER SYMPTOMS (smell, sound, vibration, smoke). A flashing check engine light is more urgent than a steady one.

---

<!-- exported from concern_category_guidelines (shop_id=7476, category=warning_light) -->
```

### Round-trip guarantee
- The parser strips ` — Diagnostic Guideline` from H1, restoring `display_label`.
- Body up to first `---` rule is the full `guideline_prose`. Single trailing newline; collapse-blanks rule in the parser is a no-op when there are no consecutive blanks.
- The HTML comment after `---` is parser-ignored (parser slices off everything at/after the HR).

---

## Q6. Design `exportConcernCategoryMd` (preferred name over `exportConcernSubcategoriesMd`)

### Disambiguation — three options considered

| Option | Verdict |
| --- | --- |
| **A.** Extend `export_concern_questions_md` to also dump sub-categories. | Reject. The current exporter feeds the LEGACY flat `upload_concern_questions_md` parser (`scheduler-admin.ts:796`, table-driven). Mixing a hierarchical shape into the same wide-table output breaks that parser. |
| **B.** Make a new exporter that dumps ALL 14 categories in one MD blob. | Reject. The uploader (`upload_concern_category_md`) is per-category-scoped (`category_slug` is required input). A single-blob exporter would have asymmetric edit ergonomics — you'd download all 14, edit one, and have no way to re-upload just that one without slicing the MD yourself. |
| **C.** New per-category exporter `exportConcernCategoryMd` that round-trips through `parseConcernCategoryMd`. | **Pick.** Mirrors the uploader's per-category scope; serializer + parser stay symmetric; output is identical in shape to the `references/concerns/{slug}/{slug}-concerns.md` template advisors already edit. |

The exporter name should be **`exportConcernCategoryMd`** (paired with `uploadConcernCategoryMd`), not `exportConcernSubcategoriesMd` — it serializes BOTH `concern_subcategories` AND `concern_questions` for a single category, exactly as the uploader writes them.

### Signature

Place in `supabase/functions/_shared/tools/scheduler-admin.ts`, immediately after `uploadConcernCategoryMd`.

```ts
export async function exportConcernCategoryMd(
  sb: SupabaseClient,
  shopId: number,
  args: { category_slug: string },
): Promise<{ md_content: string; row_count: number }> {
  if (!CONCERN_CATEGORY_SLUGS.includes(args.category_slug as ConcernCategorySlug)) {
    throw new Error(
      `category_slug must be one of: ${CONCERN_CATEGORY_SLUGS.join(", ")}`,
    );
  }
  const categorySlug = args.category_slug as ConcernCategorySlug;

  // Pull all ACTIVE sub-categories for this (shop, category), ordered.
  const { data: subRows, error: subErr } = await sb
    .from("concern_subcategories")
    .select("id, slug, display_label, display_order")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (subErr) throw new Error(`concern_subcategories export failed: ${subErr.message}`);

  const subs = (subRows ?? []) as Array<{
    id: number; slug: string; display_label: string; display_order: number;
  }>;

  // Pull all ACTIVE questions for this category (we'll group by subcategory_id).
  const { data: qRows, error: qErr } = await sb
    .from("concern_questions")
    .select("subcategory_id, question_text, display_order, options, multi_select")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (qErr) throw new Error(`concern_questions export failed: ${qErr.message}`);

  const questions = (qRows ?? []) as Array<{
    subcategory_id: number;
    question_text: string;
    display_order: number;
    options: Array<{ label: string; value: string }> | null;
    multi_select: boolean | null;
  }>;

  // Resolve a display label for the H1. Prefer guideline display_label
  // (canonical), fall back to titled slug.
  const { data: guide } = await sb
    .from("concern_category_guidelines")
    .select("display_label")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .maybeSingle();
  const categoryLabel =
    guide?.display_label ??
    categorySlug.charAt(0).toUpperCase() + categorySlug.slice(1).replace(/_/g, " ");

  const lines: string[] = [];
  lines.push(`# ${categoryLabel}`);
  lines.push("");

  const qBySubId = new Map<number, typeof questions>();
  for (const q of questions) {
    const arr = qBySubId.get(q.subcategory_id) ?? [];
    arr.push(q);
    qBySubId.set(q.subcategory_id, arr);
  }

  for (const s of subs) {
    lines.push(`-- ${s.display_label} Checklist --`);
    const qs = qBySubId.get(s.id) ?? [];
    qs.forEach((q, idx) => {
      const prefix = q.multi_select ? "[multi] " : "";
      lines.push(`${idx + 1}. ${prefix}${q.question_text}`);
      if (q.options && q.options.length > 0) {
        const optStr = q.options
          .map((o) => (o.value ? `${o.label}=${o.value}` : o.label))
          .join(" | ");
        lines.push(`   - ${optStr}`);
      }
    });
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`<!-- exported from concern_subcategories + concern_questions (shop_id=${shopId}, category=${categorySlug}) -->`);
  lines.push("");

  return { md_content: lines.join("\n"), row_count: subs.length + questions.length };
}
```

### Example output (category `brakes`, abbreviated)

```md
# Brakes

-- High-Pitched Squealing Checklist --
1. When did the squealing start?
   - Recently=recent | A while ago=ongoing
2. [multi] When do you hear it?
   - Light braking=light | Hard braking=hard | While driving=driving

-- Metallic Grinding Checklist --
1. Have you had brake work done recently?
   - Yes | No | Sometimes / Not sure

---

<!-- exported from concern_subcategories + concern_questions (shop_id=7476, category=brakes) -->
```

### Round-trip guarantee
- H1 → `display_label` (the uploader matches against `concern_questions.category` slug independently — the H1 is informational).
- `-- X Checklist --` headers regenerate the same `slug` via `slugifyForConcernSubcategory(display_label)`.
- Question position regenerates the same `display_order`.
- `[multi] ` prefix toggles `multi_select` round-trip.
- `Label=value | Label2=value2` round-trips through the options parser (lines 633-668). When `value` would equal `slugify(label)`, the exporter can simplify to bare `Label | Label2`.

---

## Q7. Register the new tools in `scheduler-tools.ts`

Add these two tool blocks alongside the other exporters at `supabase/functions/_shared/scheduler-tools.ts:1532-1562` (right after `export_concern_questions_md`). Also add the imports to the top-of-file import block (currently lines 75-76 imports `uploadConcernCategoryMd` and `uploadConcernCategoryGuidelineMd`):

**Import additions:**
```ts
import {
  // ...existing imports...
  uploadConcernCategoryMd,
  uploadConcernCategoryGuidelineMd,
  exportConcernCategoryMd,                  // NEW
  exportConcernCategoryGuidelineMd,         // NEW
} from "./tools/scheduler-admin.ts";
```

**Tool registrations** (insert immediately after the existing `export_concern_questions_md` block at line 1540):

```ts
export_concern_category_md: tool({
  description:
    "Export ONE category's hierarchical concern checklist (sub-categories + " +
    "questions) as markdown — round-trippable through upload_concern_category_md. " +
    "Output format matches the references/concerns/{slug}/{slug}-concerns.md " +
    "template: '# {Category}' + '-- {Sub-Category} Checklist --' sections + " +
    "numbered question lines (with optional '[multi]' prefix and indented " +
    "options). Only active sub-categories and questions are emitted (soft- " +
    "deleted rows are omitted; matches the uploader's diff semantics). " +
    "Returns: { md_content, row_count }.",
  inputSchema: z.object({
    category_slug: z
      .enum([
        "noise","vibration","pulling","smell","smoke","leak","warning_light",
        "performance","electrical","hvac","brakes","steering","tires","other",
      ])
      .describe("The concern category to export. Must be one of the 14 enum values."),
  }),
  execute: recorded(recorder, "export_concern_category_md", (input) =>
    exportConcernCategoryMd(sb, shopId, { category_slug: input.category_slug }),
  ),
}),

export_concern_category_guideline_md: tool({
  description:
    "Export ONE category's diagnostic-guideline prose paragraph as markdown — " +
    "round-trippable through upload_concern_category_guideline_md. Output: " +
    "'# {Display} — Diagnostic Guideline' + prose body + '---' HR. Returns " +
    "an empty md_content when no guideline row exists yet for this shop+ " +
    "category (advisor can use the empty result to seed a new one). " +
    "Returns: { md_content, row_count }.",
  inputSchema: z.object({
    category_slug: z
      .enum([
        "noise","vibration","pulling","smell","smoke","leak","warning_light",
        "performance","electrical","hvac","brakes","steering","tires","other",
      ])
      .describe("The concern category whose guideline to export."),
  }),
  execute: recorded(recorder, "export_concern_category_guideline_md", (input) =>
    exportConcernCategoryGuidelineMd(sb, shopId, { category_slug: input.category_slug }),
  ),
}),
```

---

## Q8. Round-trip test plan

The existing test file `supabase/functions/_shared/tools/scheduler-admin-catalog.test.ts` (read at lines 1-100) tests **pure helpers only** (`parseMdTable`, `parseServiceKeyList`, `arraysEqualAsSets`) via `Deno.test` + `assertEquals` from `jsr:@std/assert@^1`. It does NOT have any `roundTrip` / `parse(serialize(state))` tests for the V2 exporters — those are smoke-tested via curl after deploy (see file header lines 8-10). We should establish that test pattern in a new file (`scheduler-admin.test.ts` or a sibling `scheduler-admin-md.test.ts`) since `scheduler-admin.ts` itself doesn't have a test file today.

### Pattern (PURE parser/serializer round-trip, no DB)

Write tests against pure functions only — the serializer output for the exporter doesn't depend on the SupabaseClient if we factor out a `serializeConcernCategoryMd(subs, questions, categoryLabel)` helper from inside `exportConcernCategoryMd`. Recommend that refactor so the round-trip is testable without a DB harness:

```ts
import { assertEquals } from "jsr:@std/assert@^1";
import { parseConcernCategoryMd, parseConcernCategoryGuidelineMd } from "../scheduler-admin-md.ts";
import {
  serializeConcernCategoryMd,
  serializeConcernCategoryGuidelineMd,
} from "./scheduler-admin.ts";

Deno.test("exportConcernCategoryGuidelineMd: serializer round-trips through parser", () => {
  const state = {
    display_label: "Warning light",
    guideline_prose: "For warning lights we need: WHICH LIGHT...\n\nA flashing CEL is more urgent than a steady one.",
  };
  const md = serializeConcernCategoryGuidelineMd(state, 7476, "warning_light");
  const reparsed = parseConcernCategoryGuidelineMd(md);
  assertEquals(reparsed.display_label, state.display_label);
  assertEquals(reparsed.guideline_prose, state.guideline_prose);
});

Deno.test("exportConcernCategoryMd: serializer round-trips through parser", () => {
  const subs = [
    { id: 1, slug: "high_pitched_squealing", display_label: "High-Pitched Squealing", display_order: 1 },
    { id: 2, slug: "metallic_grinding", display_label: "Metallic Grinding", display_order: 2 },
  ];
  const questions = [
    { subcategory_id: 1, question_text: "When did it start?", display_order: 1,
      options: [{ label: "Recently", value: "recent" }, { label: "A while ago", value: "ongoing" }], multi_select: false },
    { subcategory_id: 1, question_text: "When do you hear it?", display_order: 2,
      options: [{ label: "Light braking", value: "light" }], multi_select: true },
    { subcategory_id: 2, question_text: "Have you had brake work done recently?", display_order: 1,
      options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }], multi_select: false },
  ];
  const md = serializeConcernCategoryMd(subs, questions, "Brakes");
  const reparsed = parseConcernCategoryMd(md);
  assertEquals(reparsed.display_label, "Brakes");
  assertEquals(reparsed.subcategories.length, 2);
  assertEquals(reparsed.subcategories[0].slug, "high_pitched_squealing");
  assertEquals(reparsed.subcategories[0].questions.length, 2);
  assertEquals(reparsed.subcategories[0].questions[1].multi_select, true);
  assertEquals(reparsed.subcategories[1].questions[0].options, [
    { label: "Yes", value: "yes" }, { label: "No", value: "no" },
  ]);
});
```

### End-to-end (DB-backed) test — separate file with `@supabase/supabase-js` test harness

After the pure-function round-trip passes, add a DB-backed test that:
1. Seeds a known state via the test fixtures.
2. Calls `exportConcernCategoryMd(sb, shopId, { category_slug: "brakes" })`.
3. Calls `uploadConcernCategoryMd(sb, shopId, { category_slug: "brakes", md_content: exported.md_content, audit: testAudit })`.
4. Asserts `rows_added === 0 && rows_modified === 0 && rows_deactivated === 0 && duplicate_upload === true` (the SHA-256 check at `scheduler-admin.ts:1818` fast-paths a no-op when content is byte-identical).

This is the canonical "round-trip means upload-of-export is a no-op" test.

---

## Open questions / flags

1. **Empty-state handling for guideline export.** A category with no row in `concern_category_guidelines` currently returns `{ md_content: "", row_count: 0 }`. Confirm that's the desired UX vs. emitting a placeholder MD scaffold the admin can fill in. Recommendation: emit a scaffold like `# {Title-cased slug} — Diagnostic Guideline\n\nTODO: describe what matters for {slug} concerns.\n\n---\n` so the admin has a starting point.

2. **Options simplification.** When `value === slugifyForConcernSubcategory(label) || "opt"` (matching the parser's default at line 661), the serializer can emit bare `Label` instead of `Label=value`. This makes the exported MD friendlier for hand-editing but adds a slight asymmetry vs. the DB shape. Recommend: always emit `Label=value` form for unambiguous round-trip, then a follow-up can humanize.

3. **Default options synthesized by uploader.** `uploadConcernCategoryMd` synthesizes `DEFAULT_OPTIONS` (Yes/No/Sometimes) at `scheduler-admin.ts:1935-1939` when the MD omits an options line. Exporter currently always emits the options line. On re-upload of an unchanged export, the uploader's diff detector should treat matching options as a no-op — verify in the DB-backed round-trip test.

4. **`display_label` ambiguity for category H1.** The exporter resolves the H1 label from `concern_category_guidelines.display_label`, falling back to a titlecased slug. If a shop has questions but no guideline row yet, the exported H1 is best-effort. The uploader ignores the H1 (it keys off `category_slug` from the tool args), so this is cosmetic only — but flag in the tool description so admins know.

5. **Sub-category `display_order` collisions.** Uploader writes `display_order = subcategories.length + 1` (line 588). Exporter sorts by DB `display_order` ASC. If two rows share the same order, the round-trip may re-number them. Recommend exporter use index position rather than DB column for stable round-trip.

---

## Files referenced

- `supabase/functions/_shared/scheduler-tools.ts:1510-1562` (existing exporter registrations)
- `supabase/functions/_shared/scheduler-tools.ts:1194-1327` (concern_questions + concern_category_md + concern_category_guideline_md uploader registrations)
- `supabase/functions/_shared/tools/scheduler-admin.ts:796` (uploadConcernQuestionsMd)
- `supabase/functions/_shared/tools/scheduler-admin.ts:1094-1119` (exportConcernQuestionsMd — current shape)
- `supabase/functions/_shared/tools/scheduler-admin.ts:1751-1766` (14 canonical slugs)
- `supabase/functions/_shared/tools/scheduler-admin.ts:1792-2190` (uploadConcernCategoryMd)
- `supabase/functions/_shared/tools/scheduler-admin.ts:2210-2408` (uploadConcernCategoryGuidelineMd)
- `supabase/functions/_shared/scheduler-admin-md.ts:375-415` (Parsed* interfaces + slugify)
- `supabase/functions/_shared/scheduler-admin-md.ts:449-504` (parseConcernCategoryGuidelineMd)
- `supabase/functions/_shared/scheduler-admin-md.ts:506-701` (parseConcernCategoryMd)
- `supabase/functions/_shared/scheduler-admin-md.ts:278-334` (mdTableFromRows)
- `supabase/functions/_shared/scheduler-admin-md.ts:952-981` (serializeMdSections)
- `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:781-794` (exportRoutineServicesMdV2 — pattern reference)
- `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:2040-2119` (exportSubcategoryDescriptionsMdV2 — different table, useful template for inline-comment guidance)
- `supabase/migrations/20260514000000_scheduler_concern_category_guidelines.sql:25-49` (schema)
- `supabase/migrations/20260514100000_scheduler_concern_subcategories_and_keywords.sql:43-71,99-100` (schema + FK)
- `supabase/functions/_shared/tools/scheduler-admin-catalog.test.ts:1-100` (test pattern reference)
