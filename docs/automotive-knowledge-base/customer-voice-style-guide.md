# Customer-voice style guide (for positive_examples, synonyms, lexicon)

> The classifier reads *customer* text, so its training vocabulary must sound like customers — not
> mechanics. This guide governs everything that binds to Stage-1 keywords, Stage-2 examples/synonyms, and
> the lexicon. Diagnostic prose (dossier §2/§3) stays expert; customer artifacts follow this.

## Write like the corpus, not like a technician

| Mechanic voice (WRONG for examples) | Customer voice (RIGHT) |
|---|---|
| "brake pad friction material worn to backing plate" | "grinding sound when i brake, sounds like metal on metal" |
| "CV joint failure on turns" | "clicking noise when i turn, like tick-tick-tick" |
| "coolant loss via water pump weep hole" | "theres a sweet smell and a puddle of green stuff under the front" |
| "alternator not charging, low system voltage" | "battery light came on and now its dying / had to jump it" |
| "P0420 catalyst efficiency below threshold" | "check engine light on and it smells like rotten eggs" |

## Include the messiness (it's what the classifier actually sees)

- **Misspellings:** "breaks", "squeeking", "alternater", "rotaters", "wobbaly".
- **Part-name misuse:** "rotors" meaning pads; "struts" meaning any suspension part; "transmission" for any
  drivetrain feel.
- **Slang / idiom:** "bucking", "death wobble", "chugging", "sputtering", "clunk", "whomp-whomp".
- **Mixed symptom + request:** "brakes grinding need them looked at asap", "ac not cold can i get in this week".
- **Vague forms:** "weird noise up front", "something feels off", "car shakes" — these are legitimate inputs;
  they usually route to `needs-fact-X` ambiguity, not a confident pick.
- **All-caps / fragments** (real Tekmetric style): "AC NOT COLD", "NO HEAT DRIVER SIDE".

## Anti-patterns (hard rules)

1. **No over-broad synonyms.** One bad synonym silently degrades a whole category. Never add bare
   high-frequency words ("noise", "light", "leak", "smell", "problem") as synonyms. A synonym must be ≥2
   tokens ("grinding noise") OR a domain-specific single token ("TPMS", "serpentine", "misfire").
2. **Negative examples must route.** Every `negative_example` names where it SHOULD go (`routes_to: <slug>`).
   A negative that just says "not this" is useless.
3. **Positive examples are real, not idealized.** Prefer verbatim-style corpus phrasings over clean
   textbook sentences. Cap synthetic share ~30% per subcategory; flag synthetic ones.
4. **Literalness for fact cues.** A phrasing that sets a fact slot must *literally* state it. "Shakes when I
   brake" sets a noise/feel + `onset_timing=when_braking` — it does NOT set anything about rotors, and
   "grinding" does not set a location the customer never named. `literal_cues` on slot proposals must be
   literal.
5. **US-market calibration.** Jeff's is a US shop — US terminology and the shop's real vehicle mix (from the
   corpus). Don't spend depth on Euro-only systems the corpus never mentions. Log Spanish-language phrasings
   as a backlog note for Chris; don't improvise them.
