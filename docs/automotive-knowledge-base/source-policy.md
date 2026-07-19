# Source policy — what counts as authoritative

> Two authorities, never mixed. Diagnostic claims (symptom → system) cite the **diagnostic authority**.
> Customer-language artifacts (positive_examples, synonyms, lexicon) draw from the **linguistic authority**.
> Every WebSearch/WebFetch claim carries an inline cite (URL + access date + tier).

## Diagnostic authority (for failure-mode & differential claims)

- **Tier 1 (required where available):** OEM service information; SAE terminology (J1930) and DTC
  definitions (J2012); ASE task lists + official study guides (ase.com); Bosch Automotive Handbook;
  Mitchell 1 / ALLDATA / MOTOR / Identifix **only if actually accessible — never fabricate a paywalled cite;
  fall to Tier 2.**
- **Tier 2 (acceptable for failure-mode claims):** standard textbooks (Halderman, Erjavec, Duffy —
  *Automotive Technology*); community-college OER; **parts-manufacturer technical training** (Gates, ACDelco,
  NGK, Denso, Monroe, Akebono, Dorman, Standard/Blue Streak, Moog, Raybestos) — free and rigorous about
  symptom signatures; MACS for HVAC/refrigerant.
- **Tier 3 (corroboration only, never sole source):** iATN, established diagnostician channels
  (ScannerDanner, South Main Auto, Pine Hollow), AA1Car. One Tier-3 alone never supports a claim; require
  two independent Tier-3 OR one Tier-3 + one Tier-2.

## Linguistic authority (for customer-voice artifacts — never cite for diagnosis)

1. **The Tekmetric corpus** (first + best): `scheduler-app/scripts/eval/real-concerns-tekmetric-labeled-v2.json`
   (500 real, consensus-labeled) + `eval-cases.json` (145 authored) + `real-concerns-forums.json`.
   Read these; mine real phrasings for your system.
2. **NHTSA ODI complaint narratives** (public domain, real consumer voice at scale) — nhtsa.gov complaint
   search / the ODI flat file, filtered by component. Paraphrase to first person; mark provenance `nhtsa`.
3. **Forum/Reddit phrasing patterns** — observe and paraphrase the *pattern*, never copy verbatim (copyright).
   Mark `forum-paraphrase`.
4. **Synthetic** — invented phrasings, flagged `synthetic`, capped ~30% share per subcategory.

## Denylist heuristics (skip these; do NOT "corroborate" with them)

No named author/credentials; listicle-shaped ("10 reasons your car shakes"); affiliate-link-dense;
AI-generated repair blogs; content farms; cost-estimator pages cited for diagnosis. If WebSearch surfaces
these, skip.

## Citation discipline

- Diagnostic/differential claim → inline `[source, tier, accessed 2026-07-18]`.
- Lexicon entry → `provenance: tekmetric | nhtsa | forum-paraphrase | synthetic`.
- Uncited diagnostic claims are DELETED by the verifier, not assumed correct.
- Copyright: paraphrase professional references; never bulk-copy. NHTSA narratives are public; forum posts
  are not (patterns yes, verbatim no).
