# ux-walkthrough

Single-shot persona-driven journey through a site to find friction. Read-only — Comet doesn't change anything, just acts as a user and reports back what the experience felt like.

## When this is the right template

Trigger phrases like:
- "walk through signup on the marketing site as a fresh visitor"
- "go through onboarding like a paying user"
- "click through the pricing journey and tell me where you'd give up"
- "act as an investor visiting the landing page and find the friction"
- "test the new core flow as if it's your first time"

Not for: changing settings (use pilot-admin-panel), assertion checks (use post-deploy-smoke), or bug-reproduction with specific selectors (use playwright-skill).

## Inputs you need from the user

If any are missing, ask one consolidated question:

- **Starting URL** — where the journey begins (homepage, /signup, /pricing, etc.)
- **Persona** — who Comet is pretending to be. Concrete, not abstract:
  - Bad: "a user" / "someone"
  - Good: "a 35-year-old marketing director in Berlin who's heard about the product from a colleague but hasn't visited before"
  - Good: "a returning paying user opening the app on Monday morning to do their daily review"
- **Goal** — what success looks like for this persona ("complete signup and reach the dashboard", "find the price for tier X", "publish a story", "pay for premium")
- **Stop conditions** — when Comet should give up: timeout, hitting a paywall, requiring real credit card, etc.

## The prompt

Construct and send via `comet_ask` with `newChat: true`, `timeout: 600000` (10 min — UX walkthroughs ramble):

```
You are pretending to be: [PERSONA]

Your goal: [GOAL]

Open [STARTING_URL] and go through the journey naturally — like a real user would. Don't power through; pause, read, react. Click whatever feels obvious to a person with this persona.

Stop if any of these happen:
- You hit a paywall, OAuth, or anything requiring credentials/payment
- You see the same dead-end twice
- You'd realistically close the tab in frustration
- You complete the goal
[ADDITIONAL_STOP_CONDITIONS]

After each step, narrate: what did I see, what did I do, how did it feel.

Take a screenshot any time the UI confused you, looked broken, felt slow, or you noticed something delightful — anything worth a designer seeing.

When you stop (success or quit), respond in this exact format:

PERSONA_RESTATEMENT: [one line — confirm who you were pretending to be]
GOAL_REACHED: [YES | PARTIAL | NO]
STOPPED_AT: [URL or page name where you stopped]
STOP_REASON: [completed | paywall | confusion | dead-end | broken | gave-up | other]

JOURNEY:
STEP_1: action="[what I did]" reaction="[what I saw]" friction="[none | small | medium | blocking]"
STEP_2: ...
...

TOP_FRICTION: [3 most painful moments, ranked worst-first. For each: WHERE | WHAT | WHY_IT_HURT]

WHAT_WORKED: [2 things that felt good — copy that landed, an interaction that delighted, a moment of clarity]

ONE_FIX: [if the user could change ONE thing about this flow, what should it be? Be specific — not "improve UX" but "remove the third checkbox on the signup form"]
```

## Output to the user

Don't paste the raw response. Surface this:

```
✓ ux-walkthrough: [PERSONA] → [GOAL]
Result: [GOAL_REACHED] (stopped at [STOPPED_AT], reason: [STOP_REASON])

Top 3 friction:
1. [where] — [what] — [why it hurt]
2. ...
3. ...

What worked:
- ...

ONE fix: [the single specific change Comet recommends]

[Collapsed: full journey log + screenshots]
```

If Comet captured screenshots, attach the most relevant 1-2 to your reply (the ones tied to the top friction items). The user is visual; a screenshot of the broken step is worth more than 200 words about it.

## Anti-patterns

- **Don't accept vague personas.** "A user" produces a vague journey. Push back: "What kind of user — first-timer? Returning paying customer? Someone who'd never heard of you?"
- **Don't run UX walkthroughs on flows requiring payment / real OAuth / 2FA.** The persona will hit the wall and the report becomes about the wall, not the UX. Tell user upfront if the flow has these — they may want to use a test account or skip past those steps.
- **Don't skip the ONE_FIX field.** It's the most actionable output. If Comet returns it empty, push it in a follow-up: "What's the single specific change you'd recommend?"
- **Don't over-trust the friction ranking.** Comet has good UX taste but isn't your specific target user. Treat it as a strong prior, not ground truth — especially for niche audiences (yacht brokers, professional photographers, etc.).
