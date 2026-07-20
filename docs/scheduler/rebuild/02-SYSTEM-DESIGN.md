# System design — the rebuilt classifier (data model · infra · flow), up front

> Designed before building, per Chris. Covers storage (Supabase pgvector), the end-to-end pipeline, the
> decision layer incl. the **general-testing fallback**, the flywheel, and deployment. Companion to
> `00-ARCHITECTURE.md` (the why) and the anchor base (`anchor-bank.json`, `01-taxonomy.md`).

## 1. Storage — Supabase pgvector (decided)

We store the anchor bank + embeddings in Postgres and retrieve with pgvector. Rationale: we're already on
Supabase; the **flywheel writes new anchors to the DB**, so "retrieval = a query over live rows" needs no
reload/redeploy; and at our scale HNSW is <10ms. (Brute-force cosine over ~2k vectors in an edge function
is also viable, but pgvector wins the moment the bank grows from resolved concerns — so we build it right.)

Embeddings: **`openai/text-embedding-3-small` @ 1536 dims** via the AI Gateway (the model the POC proved at
94.7% category recall@3). `vector(1536)` fits a standard HNSW index (halfvec only needed >2000 dims).

### Schema (new tables — the rebuild namespace, prefix `cx_` = concern-experience)

```sql
create extension if not exists vector;

-- The taxonomy (versioned; the DB is the source of truth, edited via schedulerconfig)
create table cx_categories (
  id text primary key,                 -- e.g. 'brakes','no_start','general_diagnostic'
  display text not null,
  kind text not null default 'symptom' -- symptom | request | situational | reserved
);
create table cx_subcategories (
  id text primary key,                 -- e.g. 'metallic_grinding'
  category_id text not null references cx_categories(id),
  display text not null,
  required_slots jsonb not null default '[]',      -- the Three-Cs facts that make it bookable
  safety_flag text not null default 'none',        -- none | advise_immediately
  starting_price_cents bigint,                     -- null = derived from the mapped service
  notes text,
  active boolean not null default true,
  version int not null default 1
);

-- The anchor bank + embeddings (knowledge seed + flywheel additions)
create table cx_anchors (
  id bigint generated always as identity primary key,
  subcategory_id text not null references cx_subcategories(id),
  category_id text not null references cx_categories(id),
  text text not null,                              -- the customer-voice phrasing
  embedding vector(1536),                          -- null until embedded (see §5)
  source text not null default 'knowledge',        -- knowledge | resolved_concern | advisor_added
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on cx_anchors using hnsw (embedding vector_cosine_ops);

-- The discriminator questions (the clarifying-question map)
create table cx_confusables (
  a_subcategory_id text not null references cx_subcategories(id),
  b_subcategory_id text not null references cx_subcategories(id),
  question text not null,
  primary key (a_subcategory_id, b_subcategory_id)
);
```

### Retrieval RPC (cosine; PostgREST can't call pgvector ops directly)

```sql
create or replace function cx_match_anchors(query_embedding vector(1536), match_count int default 30)
returns table (subcategory_id text, category_id text, text text, similarity float)
language sql stable set search_path = '' as $$
  select a.subcategory_id, a.category_id, a.text, 1 - (a.embedding <=> query_embedding) as similarity
  from public.cx_anchors a
  where a.active and a.embedding is not null
  order by a.embedding <=> query_embedding
  limit match_count;
$$;
```

The app calls `.rpc('cx_match_anchors', { query_embedding, match_count: 30 })`, then aggregates the returned
anchors into a **category shortlist** (top categories by best/aggregated similarity) + carries the top
example anchors into the LLM prompt.

## 2. The Concern record (extraction output) — per session

```sql
-- extends the session; one evolving record per booking conversation
alter table cx_sessions add column concern_record jsonb;   -- {symptom, location, when_conditions,
--   associated_signals, duration_onset, safety_flags, verbatim, candidates:[{subcategory_id,confidence,evidence}]}
```
The record accumulates across question turns; each turn re-runs retrieval + the LLM call with the record
as context (never re-ask an answered slot).

## 3. The pipeline (end to end)

```
customer text
  → embed (text-embedding-3-small)                                    ~50-100ms
  → cx_match_anchors RPC (top-30 anchors)  → category shortlist        <10ms
  → ONE structured-output LLM call (Haiku-class): given the shortlist  ~1-2s
     + a few example anchors, EXTRACT the ConcernRecord + PICK the
     subcategory + confidence + evidence quote + missing slots
  → DECISION LAYER (code, §4)
  → book | ask (chips) | general-testing | advise+call
```
Latency budget ~1.5-2.5s; prompt-cache the (small, per-shortlist) instruction block; stream the question
text when we ask. Escalate to a stronger model only on low confidence.

## 4. Decision layer + the general-testing fallback

Deterministic code decides from the LLM's report + the embedding similarity (both calibrated signals):

| Condition | Outcome |
|---|---|
| One category, confidence high, required slots filled, no safety flag | **BOOK** the mapped service; echo a confirm line |
| 2-3 plausible categories, or a required slot missing | **ASK** — chips, ≤3 turns, most-discriminating question |
| **Can't confidently pin a category** (low confidence / weak retrieval / budget exhausted, but it IS a real car concern) | **GENERAL TESTING** (see below) |
| Not a car-repair request (out_of_scope) | Politely **advise to call the shop** — not bookable |
| `safety_flag = advise_immediately` (any point) | Short-circuit → safety branch ("is it safe to drive?") + priority handling |

Thresholds are swept empirically to a target selective risk (e.g. ≤2% wrong-category among auto-accepts),
recalibrated on real labels.

### General testing (Chris, 2026-07-19) — the reserved `general_diagnostic` outcome, now concrete

When the LLM can't nail down a specific category, we still let the customer **book**, rather than dead-end:

- Books a **General Testing / Diagnostic** appointment. **No canned job** — the service advisors work out
  the exact testing when they receive the appointment email, and add the correct test(s).
- **Starts at $89.95** (`cx_subcategories.starting_price_cents = 8995` for `general_diagnostic`; "starts at"
  because advisors may add testing).
- Customer-facing note shown on this path (and in the confirmation + the advisor email):
  > *"Our service advisors will review your concern and let you know if any additional testing is needed."*
- The full **verbatim customer concern** (the ConcernRecord) goes on the appointment + the advisor email so
  the advisor has everything to refine it.

This is strictly better than "call the shop": the customer books, we capture the concern, and the human
closes the gap — and each of these becomes a labeled anchor for the flywheel once the advisor resolves it.

## 5. Embedding the anchors (seed + flywheel writes)

- **Seed:** a one-time load of `anchor-bank.json` → `cx_anchors` rows, then embed all (batch, text-embedding
  -3-small) and populate `embedding`.
- **Ongoing (flywheel):** when a resolved concern is adjudicated (advisor confirms/corrects the category on
  a closed RO, or the review console tags it), its verbatim customer text is inserted as a new `cx_anchors`
  row (`source = 'resolved_concern'`) and embedded. Use Supabase **Automatic Embeddings**
  ([docs](https://supabase.com/docs/guides/ai/automatic-embeddings)) — a trigger enqueues (pgmq) new/updated
  rows, an edge function embeds them via the gateway and writes back — so anchors self-embed with no manual
  step. Retrieval improves continuously, no retraining, no redeploy.

## 6. The flywheel / review console (schedulerconfig)

- Every interaction logged: input, ConcernRecord, candidates+similarity, decision, questions+answers,
  booking, and later the closed-RO service performed.
- A **review queue tab** in schedulerconfig: advisors triage deferrals / general-testing bookings /
  low-confidence accepts / corrections — tag each (correct / wrong-category / label-wrong / ambiguous).
- Each adjudicated case → a new labeled anchor (§5) + an eval-set case. The **closed RO (service actually
  performed)** is the ground-truth label.

## 7. Eval (unchanged discipline)

Customer-voice inputs only (never advisor RO shorthand); human-adjudicated; different-model-family judges if
scaling labels; per-class + confidence intervals; the closed RO is ground truth; frozen/versioned eval set
stamped with the taxonomy version + prompt hash. Metrics: category recall@k of the shortlister, final-
landing, selective risk / coverage, general-testing rate, question quality, turns-to-booking, safety recall.

## 8. Deployment

- The pipeline runs in a **Supabase edge function** (or a Next.js server action) that: embeds → `.rpc(
  cx_match_anchors)` → LLM call → decision. Edge keeps it close to the DB + the gateway.
- The taxonomy + anchors are DB rows, edited via the rebuilt schedulerconfig (versioned, audited RPCs like
  the current admin write path).
- Old `scheduler` + `schedulerconfig` modules stay untouched until this path is proven end-to-end, then
  archived.

## Open decisions for Chris

1. **Embedding dims:** 1536 (default, proven) vs Matryoshka-truncated 512/768 (smaller/faster, ~same recall
   at our scale). Recommend 1536 now; revisit only if latency needs it.
2. **General-testing price surface:** confirm `$89.95` "starts at" copy + the advisor-note wording above.
3. **Pipeline host:** edge function vs Next.js server action (I lean edge — closest to DB + gateway).
4. **Reserved outcomes:** confirm `general_diagnostic` (bookable, $89.95, advisor-refined) vs `out_of_scope`
   (advise-to-call, not bookable) is the split you want.
