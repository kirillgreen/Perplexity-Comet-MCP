---
name: comet-flow
description: Drive Perplexity Comet's Assistant sidecar (via MCP) for browser-agentic UI tasks — multi-step admin panels, end-to-end UX walkthroughs, post-deploy smoke tests. Use when the user says "pilot this admin", "configure [Loops/Stripe/Webflow/Google Console/Notion settings] for me", "walk through as a fresh user", "smoke test the new [feature] on [URL]", "go through signup like a real visitor", "click through the onboarding flow", or asks Comet/sidecar/sidebar to do anything UI-driven on a logged-in service. Also trigger when the user describes a multi-step browser task that would be fragile in Playwright (selectors that change, A/B-tested admin UIs, third-party SaaS dashboards) and where the value is in *the AI agent adapting to the UI* rather than running a deterministic script. Do NOT use for: web research (use Exa/WebFetch/deep-research), scraping article content (kb-ingest), JSON-LD/meta verification (searchstack-aeo), Playwright test authoring (playwright-skill), or anything where the user wants page content rather than UI interaction. Do NOT confuse with: agent-browser (Playwright, no AI agent in browser), real-browser (CDP into user's daily Chrome with Playwright), playwright-skill (scripted tests). Comet runs in a separate profile (debug port 9223) with its own logged-in state, and every cross-tab agentic action triggers a one-time "Allow once" consent dialog the user clicks.
---

# comet-flow

Wraps the Comet sidecar MCP (this repo — fork of `RapierCraft/Perplexity-Comet-MCP@v2.6.2`, run with `COMET_TARGET=sidecar`) for three recurring browser-agentic patterns that a research/scrape tool can't cover.

## When this skill is the right answer

The Comet sidecar's distinguishing trait is that it's an **AI agent inside a real browser with logged-in state**. That makes it a fit for exactly three things:

1. **Multi-step admin panel tasks** — Loops workflow setup, Google Cloud Console rules, Stripe product creation, Webflow Designer adjustments, Notion property configuration, Linear bulk operations. Playwright is fragile here because admin UIs A/B-test and rebrand constantly, so brittle selectors break weekly. Comet's agent re-reads the UI each visit and adapts.

2. **End-to-end UX walkthroughs** — "walk through signup on the new pricing page like a fresh visitor and tell me where you'd give up." A scripted test produces pass/fail, not narrative friction. Comet returns the latter, in the user's voice.

3. **Post-deploy smoke verification** — after a Webflow import or a Convex deploy, verify a feature actually works on the live URL from an end-user perspective. Faster than booting Playwright + writing a one-off spec; deeper than `curl` + grep.

## When something else is the right answer

| User says | Use this instead |
|---|---|
| "research X across the web" | `deep-research` skill or `mcp__exa__*` |
| "fetch this article into KB" | `kb-ingest` skill |
| "check JSON-LD on this page" | `searchstack-aeo` skill |
| "write a Playwright test for X" | `playwright-skill` |
| "scrape data from this site" | `agent-browser` or `mcp__exa__crawling_exa` |
| "what does this webpage say" | `WebFetch` |
| anything one-shot Q&A from training/web | direct answer or Exa, no skill needed |

The line: **content extraction → other tools; UI manipulation → comet-flow**.

## Pre-flight check (before any template)

Verify the Comet MCP is loaded in this session:

1. If `mcp__comet__comet_connect` is NOT in your available tools, stop and tell the user: "Comet MCP isn't loaded in this session. The skill needs the comet-sidecar-mcp registered. Check `claude mcp list` — should show `comet: ✓ Connected`. If not, see the project README and `SIDECAR_FORK.md` at the root of this repo."
2. Call `mcp__comet__comet_connect`. Expected: `Connected to Perplexity (target=sidecar)`. If it says `target=main`, the MCP is registered without `COMET_TARGET=sidecar` env var — inform the user and stop.
3. Tell the user: "I'll send a structured prompt to Comet's agent. When the 'Let Assistant control your browser?' dialog pops up in the Comet window (port 9223), click **Allow once**. The agent then runs autonomously and reports back."

## The three templates

Each template has its own reference file. Read the one that matches the user's request:

- **Admin panel pilot** (`references/pilot-admin-panel.md`) — drafts a step plan first, gets your OK on risky steps, then executes. Use when the task involves changing settings, creating resources, sending things, or modifying others' data.
- **UX walkthrough** (`references/ux-walkthrough.md`) — single-shot exploration as a persona. No checkpoints, no risky actions (read-only journey). Use for "find the friction" tasks.
- **Post-deploy smoke** (`references/post-deploy-smoke.md`) — single-shot verification against an explicit assertion list. Returns PASS/FAIL/UNKNOWN per assertion + screenshots on failure. Use after deploys.

## Pattern: how a Comet round-trip works through this skill

The skill is mostly orchestration around `comet_ask`. The pattern is identical across templates — what differs is the prompt body and whether you do one round-trip or several.

```
1. Confirm pre-flight (MCP loaded, sidecar tab reachable, user knows about Allow-once)
2. Construct the prompt from the template, filling [PLACEHOLDERS] with user's specifics
3. Call mcp__comet__comet_ask with: { prompt, newChat: true, timeout: <appropriate> }
4. If timeout is reached but status is WORKING → poll with comet_poll until completed
5. If sidecar's response is missing or malformed → comet_screenshot to debug, retry once
6. Parse the structured response per the template's output format
7. Show the parsed result to the user
8. For multi-round templates (admin pilot), checkpoint with the user before next round
```

Timeouts to use:
- Single Q&A or short verification: **120000ms** (2 min)
- Research-style answer with web search: **240000ms** (4 min)
- Multi-step UI walkthrough or admin pilot execution: **600000ms** (10 min) — bump higher if many risky checkpoints

## Output contract — what to give back to the user

After Comet returns, **don't dump the raw response.** Parse it per the template's defined format and show:
- A 1-line headline (PASS/FAIL/COMPLETE/STUCK)
- Key fields the user cares about (the specific findings)
- Any screenshots Comet captured (if relevant)
- Next-action suggestion if appropriate

The raw transcript can be in a collapsed/quoted block below for the user to inspect. The point of having a skill at all is that you do the parsing, not the user.

## Risky actions — when to checkpoint

If the user's task involves any of these, the skill MUST split into plan-then-execute (admin panel template) and confirm with the user before each risky step:

- Delete (anything — records, files, accounts, projects)
- Send (emails, notifications, SMS, payments)
- Charge / refund / payout
- Modify others' data (not the user's own — e.g., other team members' settings, customer records)
- Mass operations (>5 of anything: bulk delete, bulk update, bulk send)
- Public publishing (going live with a draft, making something visible)
- Changing access/permissions/keys

Default to **show plan first, ask once, then execute** unless the user explicitly says "just do it." The `pilot-admin-panel` template has the plan-then-execute logic baked in.

## Common pitfalls

- **Sidecar shows "Assistant" empty after newChat=true** — race condition between navigate and typing. Diagnose with `comet_screenshot`. If empty, retry without `newChat: true` (continue the existing sidecar conversation) — usually works on second try. See `SIDECAR_FORK.md` known limitations.
- **comet_ask returns timeout but status WORKING** — Comet is doing real work, just longer than the timeout. Don't retry — `comet_poll` until completed. The MCP's stability detector waits for response stability, which takes 6+ seconds after the agent stops typing.
- **Sidecar gives a generic chat answer instead of doing the action** — your prompt didn't trigger Comet's agentic mode. Add explicit imperative language: "Use your browser to open [URL] and ...", "Navigate to [URL] and click ...". The MCP also auto-prefixes "Use your browser to" when it detects URLs/action verbs, but you can be explicit yourself.
- **Allow-once dialog blocks indefinitely** — sidecar is paused waiting for user consent in the Comet window. If user doesn't click within ~timeout, `comet_ask` will return WORKING/IDLE with empty response. Tell user upfront they need to watch for the dialog.
- **MCP-controlled Comet has stale state** — its profile is on debug port 9223, separate from user's daily Comet. If a service expects a logged-in user and Comet's profile isn't logged in, the agent will hit auth walls. Tell user to log in once per service in the port-9223 Comet window; cookies persist across MCP runs.

## Reference files

Read the one that matches the user's request:

- `references/pilot-admin-panel.md` — multi-step admin task with plan→approve→execute loop
- `references/ux-walkthrough.md` — persona-driven friction-finding journey
- `references/post-deploy-smoke.md` — assertion-list verification with PASS/FAIL/UNKNOWN per item

Architectural background and troubleshooting:
- `../SIDECAR_FORK.md` (relative to this skill) — what's customized in this fork vs upstream, DOM mapping for the sidecar, rebase guidance
