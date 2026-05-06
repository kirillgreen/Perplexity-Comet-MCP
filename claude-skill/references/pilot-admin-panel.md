# pilot-admin-panel

Multi-step admin task with **plan → approve → execute** loop. Use when the user wants Comet to configure / set up / modify something in an admin panel (Loops, Stripe, Webflow Designer, Google Cloud, Notion settings, Linear, etc.).

## When this is the right template

Trigger phrases like:
- "configure Loops to send X when Y happens"
- "set up a Stripe product for tier Z with these prices"
- "update the Webflow page header CTA from A to B across all templates"
- "create a Google Cloud rule that ..."
- "in Notion, add this property to all rows in [database]"

Not for: read-only navigation (use ux-walkthrough), assertion-checking (use post-deploy-smoke), one-shot questions (just use comet_ask directly with no skill).

## Inputs you need from the user before starting

If the user's request is missing any of these, ask one consolidated question to fill them in. Don't loop on partial answers.

- **Service / URL** — exact admin URL where the work happens (e.g., `https://app.loops.so/`)
- **Goal** — what should be true after the task finishes (one sentence)
- **Constraints** — anything Comet should NOT do (e.g., "don't touch any campaigns named 'live'")
- **Risk tolerance** — does the user want to approve every risky step, or only mass/destructive ones? (default: every risky step)

## Round 1 — plan only (no execution)

Construct this prompt and call `comet_ask` with `newChat: true`, `timeout: 240000`:

```
You are a careful admin-panel pilot. DO NOT take any actions yet.

Open [SERVICE_URL] and look at the current state. Then outline the exact step-by-step plan to: [GOAL].

Constraints from the user: [CONSTRAINTS or "none"]

For each step, classify it as:
- SAFE: read-only, navigation, viewing settings
- WRITE: changes user's own settings/resources, low blast-radius
- RISKY: deletes, sends emails/notifications, charges/refunds, modifies others' data, mass operations (>5 items), publishing/going-live, changing access/permissions

Respond in this exact format, no extra commentary:

CURRENT_STATE: [one sentence about what you see in the panel right now]

PLAN:
STEP_1: [exact action] — [SAFE | WRITE | RISKY] — [why this is needed]
STEP_2: ...
...

SUMMARY: total_steps=[N], risky_steps=[M], estimated_minutes=[your guess]

CONFIRM_QUESTIONS: [list any specifics you'd want the user to confirm before executing — e.g., "the email subject line should be X, right?". Empty list if no ambiguity.]

Stop here. Do not execute anything. The user will review and approve.
```

Then parse the response. Show the user:
- **CURRENT_STATE** as context
- **PLAN** as a numbered list with risk badges
- **SUMMARY** stats
- **CONFIRM_QUESTIONS** if any — answer with the user before executing

If `CONFIRM_QUESTIONS` is non-empty, get answers from the user, then go to Round 2.
If empty, ask the user: "Approve this plan? (yes / yes-but-skip-risky / edit / abort)"

## Round 2 — execution

Branch on the user's approval mode:

### Mode A: "yes" (execute everything as planned)

Construct this prompt with `comet_ask`, `newChat: false` (continue the same sidecar conversation):

```
The user approved the plan. Execute all steps now. After each step:
- Take a screenshot if the step is WRITE or RISKY
- Note the exact UI state (what changed, any error/warning shown)

If you hit ANY of these, stop immediately and report:
- A confirmation dialog you didn't expect
- An error message
- The UI looking different from what your plan assumed
- A field that requires data not provided

Format the final response exactly as:

EXECUTION:
STEP_1: [original action] — [DONE | SKIPPED | FAILED] — [evidence: what you saw]
STEP_2: ...

OUTCOME: [SUCCESS | PARTIAL | FAILED]
SIDE_EFFECTS: [anything created/changed/sent that the user should know about]
NEXT_ACTIONS: [if PARTIAL or FAILED, what should happen next]
```

Use `timeout: 600000` (10 min). For very long workflows bump to 900000.

### Mode B: "yes-but-skip-risky"

Send this prompt:

```
Execute only the SAFE and WRITE steps. Skip every RISKY step and report it as SKIPPED with reason "user_skipped_risky". Same output format as before.
```

### Mode C: "edit"

Show the plan with line numbers and ask the user to specify changes (remove step, add step, change wording). Reconstruct the plan in plain text, send it back to Comet:

```
The user revised the plan. Here's the final version to execute:

[PASTE REVISED PLAN]

Execute these steps exactly. Same output format as before (EXECUTION / OUTCOME / SIDE_EFFECTS / NEXT_ACTIONS).
```

### Mode D: "abort"

Send `comet_stop` if any task is still running. Tell user "Aborted, nothing was executed."

## Round 3 (optional) — verify

If the user wants belt-and-suspenders confirmation, run a short verification prompt:

```
Without changing anything, verify the goal was achieved: [GOAL].

Look at the current state of [SERVICE_URL] and confirm each of these is true now:
- [Acceptance criterion 1 — derived from the goal]
- [Acceptance criterion 2]
...

Format: VERIFY_1: [criterion] — [TRUE | FALSE | UNCERTAIN] — [evidence]
```

## Output to the user (top-level Claude Code response)

After Round 2 completes, give the user:

```
✓ pilot-admin-panel: [GOAL]
Outcome: [SUCCESS | PARTIAL | FAILED]
Steps: [N done / M skipped / K failed]
Side effects: [list, or "none beyond the planned changes"]
[If FAILED:] Next actions: [recommendation]

[Collapsed: full execution log from Comet]
```

Don't put the verbatim Comet transcript first — parse it, surface the headline, then offer the transcript for inspection.

## Anti-patterns

- **Don't combine plan + execute in one prompt.** Comet will start doing things before the user sees the plan.
- **Don't skip the CONFIRM_QUESTIONS step** — Comet's plan can have hidden assumptions ("I'll send to this list" — which list?). Surface ambiguity early.
- **Don't trust SUCCESS without checking SIDE_EFFECTS.** Sometimes Comet succeeds at the literal task but accidentally touches adjacent settings.
