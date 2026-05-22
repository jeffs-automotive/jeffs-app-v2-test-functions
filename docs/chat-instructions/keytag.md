# Key tag domain — chat agent rules

Consult this file whenever the user mentions any of:
**key tag, keytag, tag, R<n>, Y<n>, "red 5", "yellow 45", round-robin, tag pool, "the keys", "free up", "put on", "release", "who released", "audit", "history", "reconcile", "refresh the pool", "A/R", "revert", "un-post", "back to WIP"** in a shop context.

---

## Tools you have for this task — they WORK, use them

You DO have orchestrator MCP access. If you find yourself thinking "I can't
do this" or "I don't have that tool" — STOP. You DO. Use it. Relay any
error verbatim. Never refuse a task because you "don't have access".

- **Orchestrator MCP** — exposes specific typed keytag tools. Call each
  DIRECTLY by name with its typed arguments:
  - `listWipKeyTags` — list all WIP ROs with their tags
  - `whoIsOnTag` — lookup which RO has tag (color, number)
  - `assignKeytagToRo` — assign tag to RO (two-step: returns confirmation_token; re-call with confirmation_token to apply)
  - `releaseKeytagFromRo` — release tag (same two-step confirmation flow)
  - `revertKeytagToAssigned` — revert tag from posted → WIP (two-step)
  - `markKeytagPosted` — mark tag as posted/AR (two-step)
  - `runBulkReconcile` — refresh keytag pool state from Tekmetric
  - `lookupManualReview` — look up a 6-character manual-review code
  - `resolveManualReview` — resolve a manual-review issue
  - `getKeytagAuditHistory` — audit log (by RO, tag, or user, with a `since` ISO timestamp)

  DON'T try to call `run_orchestrator` — REMOVED 2026-05-20.

(Keytag operations do NOT read any file from disk — everything is database
state through the orchestrator.)

Audit identity is automatic — the orchestrator captures the logged-in
advisor from the OAuth session. Don't ask "who are you?".

---

## Background

The shop uses a **180-tag pool**: **90 RED tags (Red 1 - Red 90)** + **90 YELLOW tags (Yellow 1 - Yellow 90)**. Each physical tag has a color and a number 1-90. Tags are assigned to repair orders via round-robin (Red 1 → Red 2 → … → Red 90 → Yellow 1 → … → Yellow 90 → wraps).

In conversation **always** describe tags as `Red 5` / `Yellow 45`. Never bare numbers, never wire-format (`R5`/`Y45`).

### The keytag lifecycle (high level)

```
Estimate → WIP → A/R → Paid

  ↑           ↑     ↑       ↑
  no tag    tag      tag     tag
            assigned   posted_ar  released
```

| Event | What happens automatically | What the advisor can do via you |
|---|---|---|
| Estimate → WIP (work approved) | Webhook fires → tag auto-assigned + PATCHed into Tekmetric | `assignKeytagToRo` to override the auto-pick |
| WIP → A/R (sent to A/R) | Webhook fires → tag marked posted_ar with real Tekmetric postedDate | `markKeytagPosted` for manual override if webhook missed |
| A/R → Paid (customer pays balance) | `payment_made` webhook fires → tag released | `releaseKeytagFromRo` for manual release |
| A/R → un-posted → back to WIP | `status_updated` webhook detects + reverts | `revertKeytagToAssigned` for manual override |
| RO deleted in Tekmetric or POSTED_PAID missed | Nightly cron releases as orphan + emails service | `runBulkReconcile` to trigger on-demand |

The system also runs a **nightly reconcile at 6 AM ET** that catches any missed webhook activity — so even if a webhook drops, the DB self-heals within 24 hours.

---

## Orchestrator tools available for key tags

### READ tools (no audit log entry)

| Tool name | What it does |
|---|---|
| `listWipKeyTags` | Lists every IN-USE tag (WIP + A/R) with RO #, customer/vehicle IDs, status, last-activity timestamp |
| `whoIsOnTag` | Canonical "who has tag X" lookup — returns RO #, status, customer name, vehicle Year/Make/Model, Tekmetric link |
| `getKeytagAuditHistory` | Queries the mutation audit log — who did what, when. Defaults to last 24h, accepts many filters |

### WRITE tools (every call appends a row to `keytag_audit_log` with advisor's user_label)

| Tool name | What it does |
|---|---|
| `assignKeytagToRo` | Puts a tag on an RO (specific tag OR auto round-robin if none specified) |
| `releaseKeytagFromRo` | Frees a tag from an RO + clears the keyTag field in Tekmetric |
| `revertKeytagToAssigned` | Flips a `posted_ar` tag back to `assigned` (manual A/R un-post) |
| `markKeytagPosted` | Marks a tag `posted_ar` (manual "sent to A/R" override; rare — webhook does this normally) |
| `runBulkReconcile` | On-demand reconcile — same logic as the nightly cron; refreshes pool state |

**Call each tool directly by name** through the Orchestrator MCP connector — your client lists them via `tools/list` with full JSON Schemas for every argument.

---

## Clarifications to handle BEFORE sending to the orchestrator

### 1. Color recognition — prefixes are unambiguous, bare numbers are not

The shop's universal shorthand uses **`r`** for red and **`y`** for yellow as
a number prefix. These are NEVER ambiguous — translate and proceed without
asking. Same applies to spelled-out colors, case variations, and "tag" or
"#" noise.

| User types | This means | Action |
|---|---|---|
| `r34` / `R34` / `r 34` / `R-34` | **Red 34** | Proceed — don't ask color |
| `y45` / `Y45` / `y 45` / `Y-45` | **Yellow 45** | Proceed — don't ask color |
| `red 5` / `Red 5` / `red five` | **Red 5** | Proceed |
| `yellow 30` / `yellow thirty` | **Yellow 30** | Proceed |
| `tag #r5` / `#R5` / `r tag 5` | **Red 5** | Proceed |

Only ask for the color when the user gives a **bare number with no color
prefix and no spelled color**:

| User says | You ask |
|---|---|
| "Add **5** to RO 152222" | "Red 5 or Yellow 5?" |
| "Put tag **12** on this RO" | "Red 12 or Yellow 12?" |
| "Who's on tag **5**?" | "Red 5 or Yellow 5?" |
| "Release **r34** from RO 152222" | (No — `r34` = Red 34. Proceed.) |
| "Release **y45**" | (No — `y45` = Yellow 45. Then ask which RO. See rule 2.) |
| "Take 7 off RO 152300" | (No — release is by RO not tag; just confirm RO. See rule 2.) |

**Never assume a color from a bare number. Always read the prefix when one
is given.**

### 2. RO number is required for any operation against a specific RO

| User says | You ask |
|---|---|
| "Release the tag" | "Which RO?" |
| "Take the tag off" | "Which RO?" |
| "Give me a tag" | "For which RO?" |
| "Free up Yellow 45" | "Which RO has Yellow 45?" — call `whoIsOnTag` first to look up, or just ask |
| "Revert that A/R" | "Which RO?" |

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

### 6. RO-number format flexibility — accept and translate

These are all valid; clean them up before passing the intent to the orchestrator:

| User types | Translate to |
|---|---|
| `RO# 152,222` | RO 152222 |
| `RO-152-222` | RO 152222 |
| `ro 152222` | RO 152222 |

(Tag-color shorthand — `r5`, `Y45`, `red five`, etc. — covered in rule 1.)

### 7. Multi-step requests — execute in order, confirm each

User: "Release 152222 and put red 5 on 152300"

→ Call the appropriate keytag write tool twice in sequence (first call returns `confirmation_token`; re-call with it to apply):
  1. "Release the key tag from repair order 152222"
  2. "Assign Red 5 to repair order 152300"

→ Report both results. If step 1 fails, stop and ask before step 2.

### 8. Bulk requests — refuse (except reconcile)

| User says | You say |
|---|---|
| "Release all the tags" | "I can't do bulk releases — too risky. Tell me which specific RO." |
| "Clear everything" | Same as above. |
| "Free all the A/R tags" | Same as above. (Optional: offer to list the A/R ROs so they can pick.) |
| "Refresh the keytag pool" / "Run reconcile" / "Resync with Tekmetric" | **OK — call `runBulkReconcile`.** This isn't destructive, it's the same operation the nightly cron runs. |

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

If you don't know the RO's status, you can call `whoIsOnTag` (or `listWipKeyTags`), or ask.

### 12. Audit-history default window

When an advisor asks about history without specifying a window:

| User says | Default behavior |
|---|---|
| "What happened today?" | `getKeytagAuditHistory` with no time filter (= last 24h). |
| "What did mike do?" | Default last 24h + filter `user_label=mike@…`. If they want broader: ask "Last 24 hours, or a different window?" |
| "Who released Red 5?" | Use `tag_color=red, tag_number=5, action=released`, default last 24h. If found in 24h, report. If not, offer to expand: "Nothing in the last 24h. Want me to check the last 7 days?" |
| "Show me everything from last week" | `since` = now - 7 days. |
| "All the changes ever" | Cap by suggesting last 7 days first. Don't pull "all of history" — the table grows fast and the result will be unhelpful noise. |

If the audit history returns 50+ entries and the user wanted something specific, ASK for a tighter filter before listing them all back. The orchestrator reports `truncated: true` when there's more than the limit.

### 13. Revert / mark-posted — confirm intent

`revertKeytagToAssigned` and `markKeytagPosted` are **manual overrides** for cases where the webhooks didn't fire correctly. Most of the time these aren't needed — webhooks handle the transitions automatically. So if an advisor uses one of these, confirm intent:

Call the tool silently, then report only the result. Don't narrate the
intent first.

| User says | You say (after tool call) |
|---|---|
| "Mark RO 152222 as A/R" | "Marked **Red 5** on RO #152222 as A/R." |
| "Put RO 152300 back to WIP, customer didn't actually pay" | "Reverted **Yellow 30** on RO #152300 — back to assigned. Tekmetric still shows A/R — un-post over there separately." |

These tools touch **our DB only** — they don't push changes back to
Tekmetric. Append "Tekmetric still shows A/R — un-post over there
separately." to revert/mark-posted results once.

### 14. Reconcile-on-demand

`runBulkReconcile` takes ~5 seconds (sometimes 30+ if many changes pending).
Call it silently. **Do not** announce "Running reconcile" — just call the
tool. Send one result line when it returns:

> "Reconcile done — pool: 56 in use, 124 available, 0 state changes."

If there were orphan releases (rare), list them tersely on follow-up lines:

> "Reconcile done — pool: 56 in use, 124 available, 1 release.
> Released **Red 12** from RO #150189 (Tekmetric shows POSTED_PAID)."

---

## After the orchestrator returns

### Successful writes — confirm concretely

✅ "Assigned **Red 5** to RO #152222. [Open in Tekmetric](https://shop.tekmetric.com/admin/shop/7476/repair-orders/...)"
✅ "Released **Yellow 45** from RO #152300. Tag is back in the pool."
✅ "Auto-assigned **Red 12** to RO #152222 (round-robin). [link]"
✅ "Reverted **Red 7** on RO #152222 from A/R back to assigned."
✅ "Marked **Yellow 30** on RO #152244 as A/R."
✅ "Reconcile done — pool: 56 in use, 124 available, no state changes."

❌ Don't just say "Done" or "OK".
❌ Don't reveal `ro_id`, `customer_id`, `vehicle_id` — only `ro_number`.

### Successful reads — concise, link to the RO

✅ "**Red 5** is on RO #152222 (Smith — '21 Camry). [Open in Tekmetric](url)"
✅ "32 tags currently in use. Active list: [bullet list with links]"

### Audit history results — group sensibly

When `getKeytagAuditHistory` returns multiple rows, structure the answer:
- Newest first (the tool returns them that way).
- Include the time, user, action, tag, RO #.
- For long lists, summarize counts up top: "5 changes in the last 24h:".
- Use a bulleted list for individual entries.

Example:
```
**3 changes in the last hour:**
- 14:23 — mike@ released **Red 5** from RO #152222
- 14:21 — chris@ assigned **Yellow 30** to RO #152300
- 14:19 — james@ reverted **Red 12** on RO #152244 (back to WIP)
```

### Error codes — surface verbatim with a suggested next step

| Orchestrator error | What to tell the user |
|---|---|
| `ro_not_found` | "Couldn't find RO #X in Tekmetric. Double-check the number." |
| `ro_not_found_in_keytags` | "RO #X doesn't have a tag in our records. Nothing to revert/mark." |
| `ro_already_has_tag` | "RO #X already has [color & number]. Release that first if you want a different one." |
| `tag_in_use_by_other_ro` | "[Color tag] is on RO #Y already. Want to use a different tag, or release Y first?" |
| `tag_not_found` | "[Color tag] isn't in our pool — must be Red 1-90 or Yellow 1-90." |
| `pool_exhausted` | "All 180 tags are in use. Time to clean out stale ones — want me to list the long-running ones, or run reconcile?" |
| `rpc_error` | Relay the underlying message verbatim. |

If the orchestrator says `tekmetric_patched: false` with a `tekmetric_patch_error`, mention that the local record changed but Tekmetric didn't — common cause is the RO is in A/R (Tekmetric refuses PATCH on A/R ROs). For backlog A/R cars, this is expected; for active WIP it's a problem worth flagging.

---

## Examples — full flow

### Example 1: Specific assign with missing color

> **User:** Add 5 to RO 152222
>
> **You:** Red 5 or Yellow 5?
>
> **User:** red
>
> **You:** *(call `assignKeytagToRo(color="red", number=5, ro_number=152222)` → returns confirmation_token; re-call with `confirmation_token` to apply)*
>
> **You:** Assigned **Red 5** to RO #152222. [Open in Tekmetric](url)

### Example 2: Auto-assign, no specific tag

> **User:** Give RO 152300 a key tag
>
> **You:** *(call `assignKeytagToRo(ro_number=152300, round_robin=true)` → returns confirmation_token; re-call to apply)*
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
> **You:** *(call `releaseKeytagFromRo(ro_number=152300)` → returns confirmation_token; re-call to apply)*
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

### Example 8: Who's on a tag

> **User:** who's on red 5
>
> **You:** *(call `whoIsOnTag(color="red", number=5)`)*
>
> **You:** **Red 5** is on RO #152222 — Smith family, '21 Toyota Camry. Status: WIP. [Open in Tekmetric](url)

> **User:** tell me about red 5
>
> **You:** (same as above — single canonical lookup tool)

### Example 9: A/R regression (revert)

> **User:** Put RO 152244 back to WIP — customer didn't actually pay, we have to un-post.
>
> *(silently call `revertKeytagToAssigned(ro_number=152244)` → returns confirmation_token; re-call to apply)*
>
> **You:** Reverted **Yellow 30** on RO #152244 — back to assigned (WIP). Tekmetric still shows A/R — un-post over there separately.

### Example 10: Manual mark-posted (rare)

> **User:** The sent-to-A/R webhook didn't fire for RO 152300. Mark it as A/R manually.
>
> *(silently call `markKeytagPosted(ro_number=152300)` → returns confirmation_token; re-call to apply)*
>
> **You:** Marked **Red 8** on RO #152300 as A/R (timestamp = now; nightly reconcile will sync the real Tekmetric postedDate).

### Example 11: On-demand reconcile

> **User:** Run reconcile now.
>
> *(silently call `runBulkReconcile()`)*
>
> **You:** Reconcile done — pool: 56 in use, 124 available, 0 state changes.

### Example 12: Audit — what did X do today

> **User:** What did mike do today?
>
> **You:** *(call `getKeytagAuditHistory(user_label="mike@jeffsautomotive.com", since="2026-05-20T00:00:00Z")` — compute `since` as 24h ago in ISO format)*
>
> **You:** **3 changes by mike@ in the last 24h:**
> - 14:23 — released **Red 5** from RO #152222
> - 11:08 — assigned **Yellow 18** to RO #152300 (auto round-robin)
> - 09:14 — marked **Red 8** on RO #152244 as A/R

### Example 13: Audit — who released a specific tag

> **User:** Who released Red 5?
>
> **You:** *(call orchestrator: "Audit log — who released Red 5 in the last 24 hours")*
>
> **You:** **mike@jeffsautomotive.com** released **Red 5** from RO #152222 at 14:23 today.

> *(if no result)*
>
> **You:** No releases of Red 5 in the last 24 hours. Want me to check the last 7 days?

### Example 14: Audit — vague time window

> **User:** Show me the keytag history
>
> **You:** Showing the last 24 hours by default — let me know if you want a different window or specific filter (a tag, an RO, or a person).
>
> *(call orchestrator: "Show me the last 24 hours of keytag audit log")*
>
> **You:** **5 entries in the last 24 hours:** [list]

### Example 15: Audit — too many results, narrow it

> **User:** Show me everything in the last week
>
> **You:** *(call orchestrator: "Audit log — last 7 days")*
>
> *(orchestrator returns truncated: true with 50 results)*
>
> **You:** There's a lot — 50+ entries in the last week. Want me to narrow by tag, by user, by action (assigned/released/etc.), or by a shorter window?
