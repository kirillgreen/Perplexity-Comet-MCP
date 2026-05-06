# post-deploy-smoke

Verify a feature works end-to-end on a live URL after a deploy. Returns explicit PASS / FAIL / UNKNOWN per assertion. Faster than booting Playwright and writing a one-off spec; deeper than `curl` + grep.

## When this is the right template

Trigger phrases like:
- "smoke test the new pricing page on staging"
- "verify the booking flow still works on prod"
- "after the CMS import, check that the sticky CTA still shows on detail pages"
- "make sure the new email-trigger actually sends when I click the button"
- "verify the latest deploy didn't break login"

Not for: deep regression coverage (use playwright-skill), exploratory friction-finding (use ux-walkthrough), or making changes (use pilot-admin-panel).

## Inputs you need from the user

If any are missing, ask one consolidated question:

- **URL** — exact target (specify staging vs prod, exact path)
- **Feature description** — what changed / what's being verified, in one sentence
- **Assertions** — explicit list of things that should be true. The skill is only as good as the assertions; vague ones produce vague results. Each assertion should be:
  - **Observable** — Comet can see it without internal state ("the heading reads X" yes; "the database has Y row" no, unless visible in the UI)
  - **Specific** — exact text, exact behavior, exact element
  - **Atomic** — one thing per assertion, not a bundle

If the user gives "everything works", push back for a 3-5 item list. Bad assertions waste the run.

## The prompt

Construct and send via `comet_ask` with `newChat: true`, `timeout: 240000`:

```
Open [URL] and verify the feature: [FEATURE_DESCRIPTION].

Check each of these assertions exactly. For each, return PASS, FAIL, or UNKNOWN with evidence — actual words/values you saw, or what blocked you from checking.

Assertions:
1. [ASSERTION_1]
2. [ASSERTION_2]
3. ...

Rules:
- If you can't reach the URL, return PROBE_FAILED with the reason and stop.
- If the page loads but an assertion can't be checked because the UI changed in a way that hides what you were looking for, return UNKNOWN with explanation — don't guess.
- Take a screenshot for any FAIL or UNKNOWN. Captions like "where assertion 2 should be visible" help.
- Don't change anything. This is read-only verification.

Format the response exactly:

URL_REACHED: [YES | NO — with reason if NO]
PAGE_TITLE: [actual page title]
PAGE_LOAD_TIME_FEELING: [fast | normal | slow]

ASSERTIONS:
ASSERTION_1: result=[PASS|FAIL|UNKNOWN] evidence="[exact words/values you saw, or why blocked]"
ASSERTION_2: ...
...

OVERALL: [PASS — all green | PARTIAL — N pass, M fail, K unknown | FAIL — any blocking failure | PROBE_FAILED — couldn't reach]

REGRESSION_SUSPECTS: [list anything that looked off but wasn't in the assertions — different button label, missing image, layout shift, etc. Include even small things; deploys often break adjacent pieces.]

SCREENSHOTS_TAKEN: [list of which assertions/observations have screenshots]
```

## Output to the user

Surface a tight summary:

```
[✓ | ✗ | ⚠] post-deploy-smoke: [FEATURE]
URL: [URL]
Overall: [OVERALL]
Pass: [N]/[total]    Fail: [M]    Unknown: [K]

[For each FAIL:]
✗ ASSERTION_K: [text]
   evidence: [what Comet saw]

[For each UNKNOWN:]
⚠ ASSERTION_K: [text]
   blocked by: [reason]

[If REGRESSION_SUSPECTS non-empty:]
Possible regressions Comet noticed (not in assertions):
- ...

[Attach screenshots for failures]
```

If `OVERALL = PASS`, give a one-line confirmation. If anything else, the user needs the details.

## Suggesting next actions

After a FAIL or PARTIAL, suggest a concrete next step:

- If the assertion was about UI text/copy → suggest checking source vs deployed (CMS-import workflows can silently wipe customizations between deploys)
- If the assertion was about behavior (button click, form submit) → suggest re-running with `pilot-admin-panel` to walk through and gather more diagnostic info
- If the assertion was about styling → suggest a visual diff or design-lead review

## Anti-patterns

- **Don't accept "everything works" as the assertion.** Push for the explicit list. The user knows what they shipped — they can write 3-5 items in 2 minutes.
- **Don't combine multiple checks in one assertion.** "The pricing page shows tier names and prices and has a CTA that links to checkout" is three assertions, not one. Split them.
- **Don't run smoke tests on flows requiring real payment.** Comet shouldn't enter real card numbers. If the assertion is "checkout works end-to-end", suggest a test account or Stripe test mode and route through `pilot-admin-panel` instead.
- **Don't skip REGRESSION_SUSPECTS.** Comet has wider eyes than the assertion list. Things it notices but wasn't asked about are often the real bugs — the assertion you didn't think to write.
