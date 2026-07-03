# Categorizing-LLM model research — 2026-07-02

> Deep-research run (104 agents: 5-angle search fan-out → source fetch → 3-vote adversarial
> verification per claim → synthesis). **Every fact below is web-sourced and was verified against
> official provider pages or a second independent source on 2026-07-02 — no training-data recall.**
> Question: best current model (Anthropic / OpenAI / Google) for the 3-stage diagnose-concern
> pipeline, and cost at our measured usage (1.6M input + 0.4M output tokens per 1,000 diagnoses;
> ~1,600 in / ~400 out per diagnosis; 20–60 diagnoses/day; customer waiting on mobile, p50 chain
> latency 6,986 ms today).

## Comparison table (verified 2026-07-02)

| Model | $/1M in | $/1M out | **$/1,000 diagnoses** | Strict JSON-schema output | Notes |
|---|---|---|---|---|---|
| **Claude Haiku 4.5** (current) | $1.00 | $5.00 | **$3.60** | ✅ GA constrained decoding | Baseline. Prompt caching unattainable at our shape (4,096-token minimum > our ~1,250–2,500-token prompts). Batch API inapplicable (latency-sensitive). |
| **gpt-5.4-nano** | $0.20 | $1.25 | **$0.82** | ✅ strict `json_schema` (CFG constrained decoding) | Cheapest live candidate (~4.4× cheaper). Artificial Analysis: 141 tok/s, 4.78 s latency (xhigh), $0.18/1M blended — fastest/cheapest of the compared small tiers. |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | $1.00 | ⚠️ **inferred, not directly verified for this model** | The "all Gemini models support full JSON Schema" claim was REFUTED 0–3 in verification; per-model confirmation needed. |
| Gemini 2.5 Flash | $0.30 | $2.50 | $1.48 | ✅ responseSchema | Previous stable fast tier. |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | $0.32 | ✅ (Firebase docs) | **DEPRECATED — shuts down 2026-10-16.** Do not anchor a migration on it. |
| gpt-5.4-mini | $0.75 | $4.50 | $3.00 | ✅ strict | ≈ current cost; no verified quality case. |
| Gemini 3.5 Flash | $1.50 | $9.00 | $6.00 (floor) | ✅ | Output billing INCLUDES thinking tokens → $6.00 is a floor. |
| Claude Sonnet 5 | $2/$10 intro | | $7.20 intro (→ ~$9.36 tokenizer-adjusted; $10.80 after 2026-08-31) | ✅ GA | Newer tokenizer ≈ +30% tokens for the same text. |
| Claude Sonnet 4.6 | $3.00 | $15.00 | $10.80 | ✅ GA | No cost case. |

Pricing sources: developers.openai.com/api/docs/pricing · ai.google.dev/gemini-api/docs/pricing ·
platform.claude.com/docs/en/about-claude/pricing (each cross-checked; AA leaderboard corroborates
the lineup). Current-lineup facts: no gpt-5.5-mini/nano exists — gpt-5.5 is the flagship
($5/$30), gpt-5.4/-mini/-nano are the value tiers; gpt-4o-mini / gpt-4.1-mini / o4-mini are
superseded; Gemini 3.1 Pro is preview-only.

## The decisive finding — Stage-3 precision is NOT a model problem

Verified across all three providers' own docs (high confidence, 3-0):
**constrained decoding guarantees schema-valid STRUCTURE, not value correctness.** Emitting a
schema-valid enum where `null` was correct (our over-assertion failure, precision 0.606) is inside
the valid output space on Anthropic, OpenAI, and Google alike. OpenAI's own documented remedy is
prompt examples + task decomposition; Google's docs say "always validate values in your
application"; Anthropic promises format only. **Switching providers does not fix Stage 3.** The
levers are prompt-side: per-slot "only if stated verbatim" instructions, few-shot
literal-extraction examples, or splitting the 29-slot extraction into smaller sub-calls.

## Recommendation

1. **Stay on Claude Haiku 4.5 and fix Stage 3 via prompting.** At 20–60 diagnoses/day the absolute
   spend is **$0.07–$0.22/day** — cost cannot justify migration risk, and no trusted third-party
   classification-accuracy comparison between these tiers survived adversarial verification
   (the quality ranking is genuinely unknown; only our own eval can settle it).
2. **If a trial is wanted, gpt-5.4-nano is the single candidate worth testing** — ~4.4× cheaper,
   benchmark-fast, verified strict-mode support. The test is cheap and already built: point
   `DIAGNOSE_CONCERN_STAGE{1,2,3}_MODEL` at it (the Vercel AI Gateway routes OpenAI) and run
   `npm run eval:diagnose` — ~$1 of tokens answers what no public benchmark can.
3. **Latency:** the verified evidence could not prove any candidate cuts our 7-second chain;
   merging Stage 1+2 into one call may cut the customer wait more than any model swap
   (flagged as an open engineering question, not a research answer).

## What could NOT be verified (honest gaps)

- **No trusted third-party evidence** on classification accuracy or literal-extraction
  faithfulness across these specific tiers survived the 3-vote verification — practitioner-choice
  evidence (requirement 4) is essentially unfulfilled; anecdotes did not withstand refutation.
- **Vercel AI Gateway pass-through of structured outputs was not verified per model** (all
  structured-output claims are scoped to native provider APIs). Known integration caveat:
  unsanitized Zod-derived schemas have 400'd against Anthropic via the AI SDK (vercel/ai #14342).
- Gemini **3.1 Flash-Lite's** structured-output support is inferred, not confirmed.
- Latency data is single-source (Artificial Analysis) and not shaped like our TTFT-dominated
  3-sequential-short-calls chain.
- All $/1k numbers assume our Haiku-measured token counts transfer across tokenizers (Sonnet 5 is
  documented ≈+30%; other providers unadjusted).
- Prices are moving targets: Sonnet 5 intro pricing ends 2026-08-31; Gemini 2.5 Flash-Lite dies
  2026-10-16.

## Refuted during verification

- "All actively supported Gemini models support full JSON Schema" — **refuted 0–3** (the Google
  blog's blanket claim is not backed per-model by the API docs).
