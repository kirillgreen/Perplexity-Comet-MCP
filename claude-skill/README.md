# claude-skill — `comet-flow`

A [Claude Code skill](https://docs.anthropic.com/en/docs/claude-code/skills) that wraps this MCP for three recurring browser-agentic patterns. Optional bonus content — the MCP works fine without it.

## What it does

Drives the Comet sidecar (via this MCP, run with `COMET_TARGET=sidecar`) for:

1. **`pilot-admin-panel`** — multi-step admin task with **plan → approve → execute** loop. The agent drafts the steps it would take, classifies each as SAFE / WRITE / RISKY, waits for user approval, then executes with checkpoints on risky steps.
2. **`audit-admin-panel`** — read-only inventory of all items in an admin panel (Loops workflows, Stripe products, Webflow pages, Notion databases, etc.) with structured per-item records and cross-cutting observations. No execute phase.
3. **`ux-walkthrough`** — single-shot persona-driven journey through a site to find friction. Read-only — Comet acts as a real user and reports back what the experience felt like, with a ranked top-3 friction list and one specific fix.
4. **`post-deploy-smoke`** — verify a feature works end-to-end on a live URL after a deploy. Returns explicit PASS / FAIL / UNKNOWN per assertion. Faster than booting Playwright + writing a one-off spec; deeper than `curl | grep`.

The skill keeps Claude Code from generating ad-hoc prompts each time, surfaces a consistent output contract for each pattern, and adds checkpoint logic for risky admin actions.

## Install

```bash
mkdir -p ~/.claude/skills/comet-flow
cp -r claude-skill/* ~/.claude/skills/comet-flow/
```

Then restart Claude Code. The skill auto-activates when you mention "pilot this admin", "walk through as a user", "smoke test the new feature", etc. — see the trigger list in `SKILL.md`.

## Files

- `SKILL.md` — entry point, when-to-use rules, output contract, common pitfalls
- `references/pilot-admin-panel.md` — admin-task plan→approve→execute orchestration
- `references/audit-admin-panel.md` — read-only admin inventory with cross-cutting observations
- `references/ux-walkthrough.md` — persona prompt template + structured friction report
- `references/post-deploy-smoke.md` — assertion-list verification template

For background on the underlying MCP behaviour (sidecar DOM mapping, completion detection, consent dialog handling), see `../SIDECAR_FORK.md` at the root of this repo.
