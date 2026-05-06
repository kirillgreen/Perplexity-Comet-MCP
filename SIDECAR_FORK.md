# Sidecar Fork — what we changed and why

This is a fork of [RapierCraft/Perplexity-Comet-MCP@v2.6.2](https://github.com/RapierCraft/Perplexity-Comet-MCP) that adds a `COMET_TARGET=sidecar` mode. In sidecar mode the MCP drives Comet's built-in **Assistant sidebar** (`https://www.perplexity.ai/sidecar`) instead of the standard Perplexity web app (`https://www.perplexity.ai/`).

Default behavior (no env var, or `COMET_TARGET=main`) is unchanged — upstream-compatible.

## Why fork

Upstream's `comet_ask` always navigates to `perplexity.ai/` and submits prompts to Perplexity's main web app. The Comet Assistant sidebar (the panel with the wave-logo "Assistant — Ask anything..." that's part of Comet's browser chrome) lives at `perplexity.ai/sidecar` and was never wired up. This fork adds that surface as an opt-in target.

Trade-off: the sidecar is a simpler chat than the main app — fewer modes, no agentic browsing markers. But it has cross-tab awareness of the user's active page, which is the actual reason to use it over plain Perplexity.

## How to switch

Default → main (upstream behaviour):
```bash
claude mcp add comet -s user -- node /path/to/this/dist/index.js
```

Sidecar → drives the Comet Assistant panel:
```bash
claude mcp add comet -s user -e COMET_TARGET=sidecar -- node /path/to/this/dist/index.js
```

Then **restart Claude Code** (MCP tools are loaded on session start).

## DOM mapping (probed empirically)

What sidecar exposes that main does NOT (or differently):

| Surface | Main app | Sidecar |
|---|---|---|
| Input element | `[contenteditable="true"]` (one of several visible inputs) | `[contenteditable="true"]` (single, unambiguous) |
| Input acceptance | `document.execCommand('insertText')` works | execCommand silently fails — needs CDP `Input.insertText` |
| Submission | Synthetic `KeyboardEvent` Enter, or click-by-position | CDP `Input.dispatchKeyEvent({ type:'keyDown', key:'Enter' })` only — no submit button exists |
| Mode switching | Search/Research/Labs/Learn buttons w/ `aria-label` | No mode buttons; uses slash-shortcuts in prompt |
| Working signal | Stop button + spinner + "Thinking" text + working patterns ("Searching", "Reviewing sources", …) | Stop button + spinner only (no working-text patterns) |
| Completion markers | "X steps completed", "Reviewed N sources", "Ask a follow-up" | None of these appear |
| Response container | `[class*="prose"]`, multiple elements with rich content | `[class*="prose"]`, single element with answer text |
| Agentic browsing tabs | Comet may open external tabs to scrape | Sidecar doesn't open external tabs — it answers directly |

Probe scripts that established this mapping live in `scripts/`:
- `probe-sidecar.mjs` — inputs / buttons / prose / mode candidates
- `probe-sidecar-typing.mjs` — `execCommand` vs `Input.insertText` vs paste-event comparison
- `probe-sidecar-submit.mjs` — full clean submit + response detection cycle
- `probe-sidecar-response.mjs` — earlier draft, kept for reference

To re-probe after Comet/Perplexity UI changes: `node scripts/probe-sidecar.mjs` (Comet must be running with `--remote-debugging-port=9223`).

## Code changes (all guarded by `TARGET === "sidecar"`)

### 1. New module: `src/target.ts`
Single source of truth for target selection. Reads `COMET_TARGET` env var once at startup.

Exports: `TARGET`, `TARGET_URL`, `isTargetUrl(url)`, `pickTargetTab(tabs)`.

### 2. `src/cdp-client.ts`
- **Imports** target helpers.
- **`reconnect()`**: prefers tab matching `isTargetUrl()`; falls back to any perplexity.ai tab, then any non-blank tab.
- **`ensureOnPerplexityTab()`**: now target-aware — uses `isTargetUrl()` for the "already there?" check, and `pickTargetTab()` to pick the right tab from `listTabsCategorized`. Method name preserved for upstream rebase ergonomics.
- **`isOnPerplexityTab()`**: returns `isTargetUrl(currentUrl)` — match is target-specific.
- **NEW `cdpInsertText(text)`**: thin wrapper around CDP `Input.insertText`.
- **NEW `cdpPressEnter()`**: thin wrapper around CDP `Input.dispatchKeyEvent` keydown+keyup with `windowsVirtualKeyCode: 13`. Required for Lexical-style editors.

### 3. `src/comet-ai.ts`
- **`sendPrompt`**: when sidecar mode, delegates to `sendPromptViaCDP`. Main path unchanged.
- **NEW `sendPromptViaCDP(prompt)`**: hard-clears input via execCommand loop (Lexical resists single-shot clear), refocuses, types via `cdpInsertText`, settles 400ms, submits via `cdpPressEnter`.
- **`getAgentStatus`**: when sidecar mode, delegates to `getSidecarStatus`. Main path unchanged.
- **NEW `getSidecarStatus()`**: simpler completion logic — works with absent step/source markers. Working = active stop button OR spinner. Completion = response present + stable + no stop button. Response extracted from prose elements with relaxed length filter (≥2 chars vs upstream's 30, since sidecar answers can be terse) and without rejecting `aside` ancestors (the sidecar itself is an aside-like surface).

### 4. `src/index.ts`
- **Imports** target helpers.
- **`comet_connect`**: prefers tab matching `isTargetUrl()`; navigates to `TARGET_URL` if not already there; reports `target=${TARGET}` in success message.
- **`comet_ask`**: replaces hardcoded `https://www.perplexity.ai/` with `TARGET_URL`. Replaces `tabs.main` with `pickTargetTab(tabs)`. The "is on perplexity?" check uses `isTargetUrl()`.
- **`comet_mode`**: when sidecar mode, returns explanatory message and no-ops (sidecar has no mode buttons; user should use slash-shortcuts in the prompt).
- **Server name**: includes target suffix (`comet-bridge-sidecar`) and fork version (`2.6.2-sidecar.1`) so `claude mcp list` makes the variant obvious.

## Upstream rebase guidance

When a new upstream release lands:

1. `git fetch upstream && git log --oneline v2.6.2..upstream/main` — see what changed.
2. Pay attention to changes in:
   - URL filtering (`url.includes('perplexity.ai')`) — may need a parallel `isTargetUrl()` substitution
   - `tabs.main` references — may need `pickTargetTab(tabs)` substitution
   - Hardcoded `https://www.perplexity.ai/` strings — substitute `TARGET_URL`
   - `sendPrompt` / `getAgentStatus` internals — verify the early `if (TARGET === "sidecar")` short-circuits still apply cleanly
3. Re-run probe scripts (`scripts/probe-sidecar*.mjs`) — the sidecar DOM changes more often than the main app since it's newer surface.
4. Bump fork version (`2.6.2-sidecar.1` → `2.6.3-sidecar.1`) in `src/index.ts` Server config.
5. Smoke test: `comet_connect` → `comet_ask` → check response.

## Known limitations

- **No mode switching in sidecar.** `comet_mode` is a no-op when `COMET_TARGET=sidecar`. To get research-style multi-source answers, prefix prompts with slash-shortcuts (the sidecar shows "Type / for search modes and shortcuts" hint).
- **Short answers (<2 chars) won't be detected as response.** Fine for typical delegated tasks; an issue if you ask the sidecar to reply with a single digit.
- **Sidecar tab must exist or be creatable.** First `comet_connect` after a fresh Comet install will need the user to dismiss Comet's onboarding screen once.
- **Cross-tab actions are handled by Comet itself** — what happens after a prompt submission depends on Comet's Assistant agent. The MCP only ferries the prompt and reads back the visible response.
- **Profile is separate from user's main Comet.** MCP launches Comet on debug port 9223, which is a different profile from the user's daily browser. Login to Perplexity Pro is required once per profile.

## v2.6.2-sidecar.2 — fixes from production smoke test

Identified during a real admin-panel audit task that exposed the previous version's blind spots. All four issues were the same underlying bug pattern: the MCP didn't separate "live agent progress" from "final response", and once it guessed wrong about completion, it cached the wrong thing and returned it forever.

### Fix 1: Answer-prose detector (was: returned step-card text as the response)

**Symptom:** On any task longer than ~10 seconds, `comet_ask` returned `"Clicking\n\nClicking\n\nClicking"` instead of the agent's actual answer. Detected via empirical probe (`scripts/probe-during-work.mjs` saved snapshots to `/tmp/sidecar-snapshots.json`): both action-step prose AND answer prose share the generic `[class*="prose"]` selector, but answer prose carries an additional `prose-str…` class modifier (likely `prose-strong`) that step cards lack.

**Fix:** New selector `[class*="prose-str"]` in `getSidecarStatus`. Combined with a pre-submit baseline (`setSidecarBaseline`) that snapshots the count of existing answer-prose elements before the new prompt is sent, so accumulated conversation history isn't misread as the current turn's response. Only NEW answer-prose elements (index >= baseline) are extracted.

### Fix 2: comet_poll cache poisoning

**Symptom:** Once `completeTask()` fired (correctly or incorrectly), `comet_poll` returned the cached value forever, even if the agent was still working. Combined with Fix 1 above, this meant a premature "completed" diagnosis became permanent.

**Fix:** When `TARGET === "sidecar"` and a cached completion exists, `comet_poll` first re-queries live DOM. If the stop button is still present (or consent dialog is up), the cache lied — session is reactivated and the live status returned. Also: if the live response is longer than the cached one (agent kept producing after we cached prematurely), prefer the live version.

### Fix 3: newChat race condition

**Symptom:** `newChat: true` sometimes left the sidecar input empty — prompt didn't land. Cause: navigate-to-/sidecar fires `loadEventFired` before React/Lexical finishes mounting, and the next `cdpInsertText` types into a transient state.

**Fix:** New `cometClient.waitForInputReady(maxMs)` helper polls for `[contenteditable="true"]` to be present AND have stable bounding-box dimensions (≥50×10) AND no `aria-busy="true"` ancestor, with two consecutive identical reads required. Replaces the fixed `setTimeout(2000)` after navigate. Falls back to a 1-second sleep if the element doesn't stabilize within 5s.

### Fix 4: Consent dialog detection

**Symptom:** When Comet showed "Let Assistant control your browser?" dialog, the MCP had no way to detect it — `comet_ask` would silently sit waiting until timeout, returning IDLE/WORKING with empty response. User had to babysit the Comet window.

**Fix:** `getSidecarStatus` now scans `body.innerText` for `/Let Assistant control your browser/i` AND verifies an "Allow once" button is visible. When detected, returns `awaitingConsent: true`. Both `comet_ask` and `comet_poll` handle this distinctly: instead of silent timeout, they return an explanatory message ("Click 'Allow once' in the Comet window, then call comet_poll"). The user gets a clear signal instead of an unexplained hang.

### Bonus: progress visibility (Fix 5)

`getSidecarStatus` now also extracts step labels from body text (Navigating / Clicking / Reading / Interacting / Searching / Analyzing / Opening / Reviewing / Preparing to assist / Typing) and returns them as a `steps[]` array, with the most recent as `currentStep`. The polling loop in `comet_ask` already collects these into `sessionState.steps`; `comet_poll` shows them so you can see "agent is on step 5: Reviewing sources" instead of staring at WORKING for two minutes.

### Files touched

- `src/comet-ai.ts` — `setSidecarBaseline()`, rewrote `getSidecarStatus()` body, added `awaitingConsent` to return type
- `src/cdp-client.ts` — added `waitForInputReady()`
- `src/index.ts` — capture baseline before `sendPrompt`; replaced fixed-sleep-after-navigate with `waitForInputReady`; consent-aware paths in `comet_ask` polling loop and `comet_poll`; sidecar-specific cache invalidation in `comet_poll`
- `scripts/probe-during-work.mjs` — new probe used to map the answer-vs-step-card class structure (kept as a regression-investigation tool)

Server name still `comet-bridge-sidecar`, version bumped to `2.6.2-sidecar.2`.

## v2.6.2-sidecar.3 — newChat actually resets the chat

### Fix 6: `newChat: true` was a no-op for sidecar

**Symptom:** Calling `comet_ask` with `newChat: true` left every task piled into the same mega-thread. Worse: when the input editor was in an already-conversational state with prior content, `Input.dispatchKeyEvent` Enter sometimes failed to submit (got interpreted as newline rather than send), and the prompt sat in the input box forever.

**Cause:** Sidecar's chat thread is keyed by URL (`https://www.perplexity.ai/sidecar/search/<chat-id>`). Calling `Page.navigate` back to `/sidecar` updates the URL but the existing tab's React state (the conversation) survives — the navigation just appears to "reload" while preserving the chat.

**Fix:** New `cometClient.startNewSidecarChat()` finds and clicks the `button[aria-label*="New thread"]` button (the pencil icon at top-right of the sidecar; keyboard shortcut ⌘K). This both clears the chat AND routes the URL back to plain `/sidecar`. Verified empirically: after click, `[class*="prose-str"]` count drops to 0 and the `/search/<id>` URL suffix disappears.

`index.ts` newChat branch for sidecar now: connect to sidecar tab → click new-thread button → wait for input ready → type. Falls back to navigate if the button isn't found (e.g., we're already on a fresh chat).

### Files touched

- `src/cdp-client.ts` — added `startNewSidecarChat()`
- `src/index.ts` — sidecar newChat branch uses button click instead of navigate
- `scripts/probe-newchat-button.mjs` — finds New-thread button (kept for regression debugging)
- `scripts/test-new-thread-click.mjs` — verifies clicking it resets the chat (kept for regression debugging)

Server name still `comet-bridge-sidecar`, version bumped to `2.6.2-sidecar.3`.

## v2.6.2-sidecar.4 — consent dialog confirmation watch

### Fix 7: false-positive `awaiting_consent` on transient dialogs

**Symptom:** When Comet had a cached "Allow always" or recent "Allow once" grant for the target domain, it sometimes briefly flashed the consent dialog while consulting that cache, then auto-dismissed it. Our detector caught the dialog in that brief window and bailed the entire `comet_ask` task — even though the user never actually saw or acted on a dialog. Recovery via `comet_poll` worked, but it was an avoidable interruption.

**Fix:** When `getSidecarStatus` returns `awaitingConsent: true` inside the `comet_ask` polling loop, wait 3 seconds and re-check. If the dialog is still up after the wait → bail with the consent message (real consent needed). If it auto-resolved → continue normal polling. The 3-second budget is enough for cached grants to resolve and short enough that real users don't get frustrated.

`comet_poll` was left as-is — when the user is explicitly polling, surfacing the consent flag immediately is the right behaviour (they want to know to act).

### Files touched

- `src/index.ts` — confirmation watch in `comet_ask` polling loop's awaitingConsent branch

Server name still `comet-bridge-sidecar`, version bumped to `2.6.2-sidecar.4`.
