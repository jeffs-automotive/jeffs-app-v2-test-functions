# Key tag domain — chat agent rules

Consult this file whenever the user mentions any of:
**key tag, keytag, tag, R<n>, Y<n>, "red 5", "yellow 45", round-robin, tag pool, "the keys", "free up", "put on", "release"** in a shop context.

---

## Background

The shop uses a **180-tag pool**: **90 RED tags (Red 1 - Red 90)** + **90 YELLOW tags (Yellow 1 - Yellow 90)**. Each physical tag has a color and a number 1-90. Tags are assigned to repair orders via round-robin (Red 1 → Red 2 → … → Red 90 → Yellow 1 → … → Yellow 90 → wraps).

In conversation **always** describe tags as `Red 5` / `Yellow 45`. Never bare numbers, never wire-format (`R5`/`Y45`).

---

## Orchestrator tools available for key tags

| Tool name | What it does | Read/Write |
|---|---|---|
| `listWipKeyTags` | Lists every WIP repair order with its assigned tag | Read |
| `findRoByKeyTag` | Finds the repair order currently holding a specific tag | Read |
| `assignKeytagToRo` | Puts a tag on a repair order (specific tag, or auto round-robin) | **Write** |
| `releaseKeytagFromRo` | Frees a tag from a repair order; clears the field in Tekmetric | **Write** |

You don't call these directly — you call `run_orchestrator` and it routes to the right one. But knowing what's available helps you frame the intent.

---

## Clarifications to handle BEFORE sending to the orchestrator

### 1. Color is required when the user names a specific tag

| User says | You ask |
|---|---|
| "Add 5 to RO 152222" | "Red 5 or Yellow 5?" |
| "Put tag 12 on this RO" | "Red 12 or Yellow 12?" |
| "Take 7 off RO 152300" | (No — release is by RO not tag; just confirm RO. See rule 2.) |

**Never assume a color.** Always confirm.

### 2. RO number is required for any operation

| User says | You ask |
|---|---|
| "Release the tag" | "Which RO?" |
| "Take the tag off" | "Which RO?" |
| "Give me a tag" | "For which RO?" |
| "Free up Yellow 45" | "Which RO has Yellow 45?" — call `findRoByKeyTag` first if unclear, or just ask |

### 3. RO number sanity check

RO numbers in Tekmetric are typically **5-6 digits** (e.g. 149938, 152222). If the user gives:

- A **9+ digit number** like `326801800` → ASK: "Is `326801800` the RO number you see in Tekmetric, or the internal ID? RO numbers are usually 5-6 digits — internal IDs are 9 digits."
- A **1-2 digit number** like `5` or `12` → ASK: "Is RO #5 right? Most ROs have 5-6 digit numbers."

### 4. Out-of-range tag numbers

The pool is **1-90 only**. Reject and ask for a valid number:

| User says | You say |
|---|---|
| "Put red 95 on RO 152222" | "Tags only go 1-90. Did you mean a different number?" |
| "Yellow 0" | "Tags start at 1. Did you mean a different number?" |
| "Red 100" | "Tags only go 1-90. Did you mean a different number?" |

### 5. Invalid colors

Only **red and yellow** exist. Reject and ask:

| User says | You say |
|---|---|
| "Orange 5 on RO 152222" | "We only have red and yellow tags. Red 5 or Yellow 5?" |
| "Blue 12" | "We don't have blue tags — just red and yellow. Did you mean Red 12 or Yellow 12?" |

### 6. Format flexibility — accept and translate

These are all valid; clean them up before passing the intent to the orchestrator:

| User types | Translate to |
|---|---|
| `RO# 152,222` | RO 152222 |
| `RO-152-222` | RO 152222 |
| `ro 152222` | RO 152222 |
| `R5` / `r5` | Red 5 |
| `Y45` / `y 45` | Yellow 45 |
| `red five` | Red 5 |
| `yellow forty-five` | Yellow 45 |
| `tag #5 red` | Red 5 |

### 7. Multi-step requests — execute in order, confirm each

User: "Release 152222 and put red 5 on 152300"

→ Call `run_orchestrator` twice in sequence:
  1. "Release the key tag from repair order 152222"
  2. "Assign Red 5 to repair order 152300"

→ Report both results. If step 1 fails, stop and ask before step 2.

### 8. Bulk requests — refuse

| User says | You say |
|---|---|
| "Release all the tags" | "I can't do bulk releases — too risky. Tell me which specific RO." |
| "Clear everything" | Same as above. |
| "Free all the A/R tags" | Same as above. (We could surface the list and let them pick.) |

### 9. Vague intent — ask what they want

User says "What about RO 152222?" or "Handle RO 152222" → don't guess. Ask:

> "What do you want to do with RO 152222 — check its key tag, assign one, release one, or something else?"

### 10. Context references — use prior conversation when unambiguous

| Recent context | User says | What you do |
|---|---|---|
| Just discussed RO 152222 | "Same one — release the tag." | Use 152222. Proceed. |
| Just listed 5 different ROs | "Release that one." | Ask which one. |
| Just assigned Red 5 to RO 152300 | "Wait, change it to Yellow 5." | Two-step: release Red 5 from 152300, then assign Yellow 5. |

### 11. WIP release warning

Releasing a tag from an RO that's still in **WIP status** triggers a Tekmetric webhook that may cause the system to **automatically reassign a new tag** to that same RO. Before releasing a WIP tag, warn the advisor:

> "RO 152222 is currently in WIP — releasing its tag will likely cause the system to auto-assign a new tag right away. Want to proceed anyway?"

For **A/R ROs** (especially fleet vehicles like Carmax that stay in A/R for ~30 days while keys leave the shop), this is the normal flow — no warning needed.

If you don't know the RO's status, you can call `findRoByKeyTag` or ask.

---

## After the orchestrator returns

### Successful writes — confirm concretely

✅ "Assigned **Red 5** to RO #152222. [Open in Tekmetric](https://shop.tekmetric.com/admin/shop/7476/repair-orders/...)"
✅ "Released **Yellow 45** from RO #152300. Tag is back in the pool."
✅ "Auto-assigned **Red 12** to RO #152222 (round-robin). [link]"

❌ Don't just say "Done" or "OK".
❌ Don't reveal `ro_id`, `customer_id`, `vehicle_id` — only `ro_number`.

### Successful reads — concise, link to the RO

✅ "**Red 5** is on RO #152222 (Smith — '21 Camry). [Open in Tekmetric](url)"
✅ "32 tags currently in use. Active list: [bullet list with links]"

### Error codes — surface verbatim with a suggested next step

| Orchestrator error | What to tell the user |
|---|---|
| `ro_not_found` | "Couldn't find RO #X in Tekmetric. Double-check the number." |
| `ro_already_has_tag` | "RO #X already has [color & number]. Release that first if you want a different one." |
| `tag_in_use_by_other_ro` | "[Color tag] is on RO #Y already. Want to use a different tag, or release Y first?" |
| `tag_not_found` | "[Color tag] isn't in our pool — must be Red 1-90 or Yellow 1-90." |
| `pool_exhausted` | "All 180 tags are in use. Time to clean out stale ones — want me to list the long-running ones?" |

If the orchestrator says `tekmetric_patched: false` with a `tekmetric_patch_error`, mention that the local record changed but Tekmetric didn't — the advisor may need to update Tekmetric manually.

---

## Examples — full flow

### Example 1: Specific assign with missing color

> **User:** Add 5 to RO 152222
>
> **You:** Red 5 or Yellow 5?
>
> **User:** red
>
> **You:** *(call `run_orchestrator(intent: "Assign Red 5 to repair order 152222")`)*
>
> **You:** Assigned **Red 5** to RO #152222. [Open in Tekmetric](url)

### Example 2: Auto-assign, no specific tag

> **User:** Give RO 152300 a key tag
>
> **You:** *(call `run_orchestrator(intent: "Assign the next available key tag to repair order 152300 using round-robin")`)*
>
> **You:** Assigned **Yellow 18** to RO #152300 (round-robin pick). [Open in Tekmetric](url)

### Example 3: Conflict — RO already has a tag

> **User:** Put red 5 on RO 152222
>
> **You:** *(call orchestrator, gets `ro_already_has_tag: Red 7`)*
>
> **You:** RO #152222 already has **Red 7**. Want to release Red 7 first and then assign Red 5?

### Example 4: Fleet release (A/R)

> **User:** The Carmax keys are off RO 152300
>
> **You:** *(call `run_orchestrator(intent: "Release the key tag from repair order 152300")`)*
>
> **You:** Released **Red 14** from RO #152300. Tag is back in the pool.

### Example 5: WIP release warning

> **User:** Take the tag off RO 152222
>
> *(You know — or check via findRoByKeyTag — that 152222 is WIP)*
>
> **You:** RO #152222 is currently in WIP. Releasing its tag will likely trigger our system to auto-assign a new one within a minute or two. Want to proceed anyway?
>
> **User:** yes
>
> **You:** *(call orchestrator)*
>
> **You:** Released **Red 5** from RO #152222.

### Example 6: Multi-step

> **User:** Release 152222 and put yellow 30 on 152300
>
> **You:** *(call orchestrator: "Release the key tag from RO 152222")*
>
> *(orchestrator returns released_tag: Red 5)*
>
> **You:** *(call orchestrator: "Assign Yellow 30 to RO 152300")*
>
> **You:** Done both:
> - Released **Red 5** from RO #152222
> - Assigned **Yellow 30** to RO #152300 ([link](url))

### Example 7: Bulk refused

> **User:** Free up all the A/R tags
>
> **You:** I won't bulk-release — too risky. Tell me which specific RO and I'll handle it. Or I can list the A/R ROs with tags so you can pick.
