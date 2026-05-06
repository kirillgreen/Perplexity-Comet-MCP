# audit-admin-panel

Single-shot **read-only inventory** of all items in an admin panel — workflows in Loops, products in Stripe, page templates in Webflow Designer, databases in Notion, automations in Zapier, etc. Returns a structured per-item report plus cross-cutting observations. No checkpoints, no execute phase — Comet just looks and reports.

## When this is the right template

Trigger phrases like:
- "audit my Loops workflows" / "what email automations are configured"
- "list all products in my Stripe account with their prices and active subscribers"
- "inventory the Notion databases shared with the team"
- "what scheduled jobs are configured in Railway / cron / etc."
- "audit my Linear filters and saved views"
- "look at my Google Cloud rules and tell me what's there"
- "what GitHub Actions workflows do we have"

Not for: changing settings (use `pilot-admin-panel` — that's plan→approve→execute), one-page deep-dives (use `ux-walkthrough`), feature verification (use `post-deploy-smoke`).

## Why this needs its own template

Audit is structurally different from the other three patterns:
- Plan→approve→execute is overkill for a read-only task — there are no risky steps to checkpoint
- UX walkthrough wants narrative friction — audit wants structured per-item data
- Post-deploy smoke wants explicit assertions — audit wants discovery (you don't yet know what's there)

The output shape is repeating per-item structured records + cross-item observations.

## Inputs you need from the user

If any are missing, ask one consolidated question:

- **Service URL** — exact admin URL (e.g., `https://app.loops.so/`, `https://dashboard.stripe.com/products`, `https://linear.app/<workspace>/views`)
- **Item type** — what's being inventoried ("workflows", "products", "rules", "automations") — the agent uses this to know what to click into
- **Per-item fields** — what to record per item. Be explicit; vague fields produce vague reports. E.g., for Loops: name, status, trigger, audience, steps, last-edited, active-users
- **Scope filter** (optional) — ignore archived / draft / paused / etc., or include them. Default: include everything visible
- **Cross-item questions** (optional) — what synthesis you want. Defaults: status distribution, trigger distribution, biggest by [some metric], stalest, anomalies

## The prompt

Construct and send via `comet_ask` with `newChat: true`, `timeout: 600000` (10 min — auditing N items requires N+1 page loads):

```
Use your browser to open [SERVICE_URL] and audit [ITEM_TYPE] configured in the account. This is read-only — don't change, edit, send, or delete anything.

For each [ITEM] you find:

1. Click into it to see its full structure.
2. Read these fields:
   [FIELD_LIST — one per line, named exactly as you want them in the output]
3. Note anything odd about it.

After all items, provide cross-cutting analysis:
[CROSS_ITEM_QUESTIONS or default list]

Output format:

ITEM_N:
  NAME: [exact name as shown in the panel]
  [FIELD_1]: [value]
  [FIELD_2]: [value]
  ...
  NOTES: [any oddities — broken-looking config, deprecated naming, very-old last-edit, suspicious values]

After all items:

SUMMARY:
  TOTAL: [N]
  BY_STATUS: [breakdown]
  [OTHER_CROSS_ITEM_FIELDS]: [values]
  OBSERVATIONS: [3-5 bullet points — patterns across the system: redundancies, gaps, inconsistencies, naming chaos, anything a human owner should look at]

If you can't access an item (permission, error, etc.), include in:
SKIPPED:
  - [name]: [reason]

If the account has zero items configured, say "NO_ITEMS_FOUND" and describe what you see on the dashboard instead.
```

## Output to the user

After Comet returns, **don't dump the raw response.** Surface this:

```
✓ audit-admin-panel: [ITEM_TYPE] in [SERVICE_NAME]
Total: [N] (by status: [breakdown])

Top observations:
1. [highest-priority finding]
2. ...
3. ...

[If anything was anomalous:]
🚩 Anomalies worth checking:
- [item]: [issue]
- ...

[Collapsed: full per-item inventory]
```

Lead with the OBSERVATIONS bullets — those are the value of an audit. The per-item details should be one click/expand away, not the headline.

## Recommended next steps after audit

The audit's value is the OBSERVATIONS, not the inventory itself. After surfacing them, suggest:
- For broken/anomalous items → propose a Linear ticket or `pilot-admin-panel` task to fix
- For naming inconsistencies → quick `pilot-admin-panel` rename pass
- For stale items → ask user "want to delete or archive these?" (RISKY action — go through plan→approve)

## Anti-patterns

- **Don't accept vague field lists.** "Tell me about my workflows" produces shallow output. Push for the explicit list — the user knows what they actually want to know.
- **Don't combine audit + execute in one task.** Always finish the audit, surface findings, get user approval, then run a separate `pilot-admin-panel` task. Mixing them defeats the read-only safety property of audit.
- **Don't audit huge inventories blindly.** If the user has 200+ items, ask whether to scope to a filter (status=Live, last_edited > 30d, etc.) before unleashing a 30-minute task.
- **Don't trust counts blindly.** If Comet reports "47 workflows" but the user expects ~50, surface the discrepancy. The agent might miss items that are paginated or filtered out by the panel's default view.
