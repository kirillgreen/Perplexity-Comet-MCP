// Comet AI interaction module
// Handles sending prompts to Comet's AI assistant and reading responses

import { cometClient } from "./cdp-client.js";
import { TARGET } from "./target.js";

// Input selectors - contenteditable div is primary for Perplexity
const INPUT_SELECTORS = [
  '[contenteditable="true"]',
  'textarea[placeholder*="Ask"]',
  'textarea[placeholder*="Search"]',
  'textarea',
  'input[type="text"]',
];

export class CometAI {
  /**
   * Find the first matching element from a list of selectors
   */
  private async findInputElement(): Promise<string | null> {
    for (const selector of INPUT_SELECTORS) {
      const result = await cometClient.evaluate(`
        document.querySelector(${JSON.stringify(selector)}) !== null
      `);
      if (result.result.value === true) {
        return selector;
      }
    }
    return null;
  }

  /**
   * Send a prompt to Comet's AI (Perplexity)
   */
  async sendPrompt(prompt: string): Promise<string> {
    // Sidecar uses a Lexical-style editor that ignores execCommand-based input —
    // route through CDP Input.insertText + native key events instead.
    if (TARGET === "sidecar") {
      return this.sendPromptViaCDP(prompt);
    }

    const inputSelector = await this.findInputElement();

    if (!inputSelector) {
      throw new Error("Could not find input element. Navigate to Perplexity first.");
    }

    // Use execCommand for contenteditable elements (works with React/Vue)
    const result = await cometClient.evaluate(`
      (() => {
        const el = document.querySelector('[contenteditable="true"]');
        if (el) {
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, ${JSON.stringify(prompt)});
          return { success: true };
        }
        // Fallback for textarea
        const textarea = document.querySelector('textarea');
        if (textarea) {
          textarea.focus();
          textarea.value = ${JSON.stringify(prompt)};
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true };
        }
        return { success: false };
      })()
    `);

    const typed = (result.result.value as { success: boolean })?.success;
    if (!typed) {
      throw new Error("Failed to type into input element");
    }

    // Submit the prompt
    await this.submitPrompt();

    return `Prompt sent: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`;
  }

  /**
   * Sidecar-specific prompt submission via CDP-level Input methods.
   * Sidecar's contenteditable is React-controlled (Lexical or similar) and
   * does not respond to document.execCommand or synthetic KeyboardEvents.
   * Probed empirically — see SIDECAR_FORK.md.
   */
  private async sendPromptViaCDP(prompt: string): Promise<string> {
    // Find input — sidecar has exactly one [contenteditable="true"]
    const hasInput = await cometClient.evaluate(`
      (() => {
        const el = document.querySelector('[contenteditable="true"]');
        if (!el) return { ok: false };
        el.focus();
        return { ok: true };
      })()
    `);
    if (!(hasInput.result.value as { ok: boolean })?.ok) {
      throw new Error("Could not find sidecar input. Ensure Comet is on /sidecar.");
    }

    // Hard-clear (Lexical can resist single selectAll+delete; loop until empty or capped).
    for (let i = 0; i < 15; i++) {
      const remaining = await cometClient.evaluate(`
        (() => {
          const el = document.querySelector('[contenteditable="true"]');
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          return el.innerText.length;
        })()
      `);
      if ((remaining.result.value as number) <= 1) break;
    }

    // Refocus and inject text via CDP (OS-level, framework-agnostic)
    await cometClient.evaluate(`document.querySelector('[contenteditable="true"]').focus()`);
    await cometClient.cdpInsertText(prompt);

    // Brief settle so Lexical commits the input to its internal state
    await new Promise(resolve => setTimeout(resolve, 400));

    // Submit via native Enter keypress at CDP level
    await cometClient.cdpPressEnter();

    return `Prompt sent: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`;
  }

  /**
   * Submit the current prompt
   */
  private async submitPrompt(): Promise<void> {
    // Wait for React to process the typed content
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify text was typed before attempting submit
    const hasContent = await cometClient.evaluate(`
      (() => {
        const el = document.querySelector('[contenteditable="true"]');
        if (el && el.innerText.trim().length > 0) return true;
        const textarea = document.querySelector('textarea');
        if (textarea && textarea.value.trim().length > 0) return true;
        return false;
      })()
    `);

    if (!hasContent.result.value) {
      throw new Error("Prompt text not found in input - typing may have failed");
    }

    // Strategy 1: Simulate Enter key via DOM events (most reliable for contenteditable)
    const enterResult = await cometClient.evaluate(`
      (() => {
        const el = document.querySelector('[contenteditable="true"]') ||
                   document.querySelector('textarea');
        if (!el) return { success: false, reason: 'no input element' };

        el.focus();

        // Create and dispatch Enter key events
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        });

        el.dispatchEvent(enterEvent);

        // Also dispatch keyup
        const keyupEvent = new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true
        });
        el.dispatchEvent(keyupEvent);

        return { success: true };
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 800));

    // Check if submission worked
    const submitted = await cometClient.evaluate(`
      (() => {
        const el = document.querySelector('[contenteditable="true"]');
        // If input is empty or nearly empty, submission worked
        if (el && el.innerText.trim().length < 5) return true;
        // Check for loading indicators
        const hasLoading = document.querySelector('[class*="animate-spin"], [class*="animate-pulse"]') !== null;
        const hasThinking = document.body.innerText.includes('Thinking');
        return hasLoading || hasThinking;
      })()
    `);
    if (submitted.result.value) return;

    // Strategy 2: Click the submit button directly
    const clickResult = await cometClient.evaluate(`
      (() => {
        // Try specific submit button selectors first
        const selectors = [
          'button[aria-label*="Submit"]',
          'button[aria-label*="Send"]',
          'button[aria-label*="Ask"]',
          'button[type="submit"]',
          'form button[type="button"]:last-of-type',
        ];

        for (const sel of selectors) {
          const btn = document.querySelector(sel);
          if (btn && !btn.disabled && btn.offsetParent !== null) {
            btn.click();
            return { success: true, method: 'selector', selector: sel };
          }
        }

        // Find the submit button by position (usually rightmost button near input)
        const inputEl = document.querySelector('[contenteditable="true"]') ||
                        document.querySelector('textarea');
        if (inputEl) {
          const inputRect = inputEl.getBoundingClientRect();
          let parent = inputEl.parentElement;
          let candidates = [];

          // Search up the DOM tree
          for (let i = 0; i < 5 && parent; i++) {
            const btns = parent.querySelectorAll('button');
            for (const btn of btns) {
              if (btn.disabled || btn.offsetParent === null) continue;

              const btnRect = btn.getBoundingClientRect();
              const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();

              // Skip mode/attach/voice/menu buttons
              if (ariaLabel.includes('search') || ariaLabel.includes('research') ||
                  ariaLabel.includes('labs') || ariaLabel.includes('learn') ||
                  ariaLabel.includes('attach') || ariaLabel.includes('voice') ||
                  ariaLabel.includes('menu') || ariaLabel.includes('more')) {
                continue;
              }

              // Button should be visible and to the right of input
              if (btnRect.width > 0 && btnRect.height > 0) {
                candidates.push({ btn, x: btnRect.right, y: btnRect.top });
              }
            }
            parent = parent.parentElement;
          }

          // Click the rightmost button (usually submit)
          if (candidates.length > 0) {
            candidates.sort((a, b) => b.x - a.x);
            candidates[0].btn.click();
            return { success: true, method: 'position' };
          }
        }

        return { success: false, reason: 'no button found' };
      })()
    `);

    await new Promise(resolve => setTimeout(resolve, 500));

    // Final verification and last resort
    const finalCheck = await cometClient.evaluate(`
      (() => {
        const el = document.querySelector('[contenteditable="true"]');
        if (el && el.innerText.trim().length < 5) return true;
        const hasLoading = document.querySelector('[class*="animate"]') !== null;
        const hasThinking = document.body.innerText.includes('Thinking');
        return hasLoading || hasThinking;
      })()
    `);

    if (!finalCheck.result.value) {
      // Last resort: try form submit
      await cometClient.evaluate(`
        (() => {
          const form = document.querySelector('form');
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        })()
      `);
    }
  }

  // Track response stability for completion detection
  private lastResponseText: string = '';
  private stableResponseCount: number = 0;
  private readonly STABILITY_THRESHOLD: number = 2; // Response must be same for 2 checks

  /**
   * Check if response has stabilized (same content for multiple polls)
   */
  isResponseStable(currentResponse: string): boolean {
    if (currentResponse && currentResponse.length > 50) {
      if (currentResponse === this.lastResponseText) {
        this.stableResponseCount++;
      } else {
        this.stableResponseCount = 0;
        this.lastResponseText = currentResponse;
      }
      return this.stableResponseCount >= this.STABILITY_THRESHOLD;
    }
    return false;
  }

  /**
   * Reset stability tracking (call when starting new prompt)
   */
  resetStabilityTracking(): void {
    this.lastResponseText = '';
    this.stableResponseCount = 0;
    this.sidecarLastResponse = '';
    this.sidecarStableCount = 0;
  }

  /**
   * Get current agent status and progress (for polling)
   */
  async getAgentStatus(): Promise<{
    status: "idle" | "working" | "completed";
    steps: string[];
    currentStep: string;
    response: string;
    hasStopButton: boolean;
    agentBrowsingUrl: string;
    isStable: boolean;
    awaitingConsent?: boolean;
  }> {
    if (TARGET === "sidecar") {
      return this.getSidecarStatus();
    }

    // Get browsing URL from agent's tab
    let agentBrowsingUrl = '';
    try {
      const tabs = await cometClient.listTabsCategorized();
      if (tabs.agentBrowsing) {
        agentBrowsingUrl = tabs.agentBrowsing.url;
      }
    } catch {
      // Continue without URL
    }

    const result = await cometClient.safeEvaluate(`
      (() => {
        const body = document.body.innerText;

        // Check for active stop button (more comprehensive check)
        let hasActiveStopButton = false;
        for (const btn of document.querySelectorAll('button')) {
          const rect = btn.querySelector('rect');
          const svg = btn.querySelector('svg');
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          const btnText = btn.innerText.toLowerCase();

          // Stop button indicators: square icon (rect), "stop" label, or specific SVG patterns
          const isStopButton = rect ||
                              ariaLabel.includes('stop') ||
                              ariaLabel.includes('cancel') ||
                              btnText === 'stop';

          if (isStopButton && btn.offsetParent !== null && !btn.disabled) {
            hasActiveStopButton = true;
            break;
          }
        }

        // More comprehensive loading detection
        const hasLoadingSpinner = document.querySelector(
          '[class*="animate-spin"], [class*="animate-pulse"], [class*="loading"], [class*="thinking"]'
        ) !== null;

        // Check for "Thinking" indicator specifically
        const hasThinkingIndicator = body.includes('Thinking') && !body.includes('Thinking about');

        const hasStepsCompleted = /\\d+ steps? completed/i.test(body);
        const hasFinishedMarker = body.includes('Finished') && !hasActiveStopButton;
        const hasReviewedSources = /Reviewed \\d+ sources?/i.test(body);
        const hasSourcesIndicator = /\\d+\\s*sources?/i.test(body); // "10 sources" etc
        const hasAskFollowUp = body.includes('Ask a follow-up') || body.includes('Ask follow-up');

        // Check for prose content (actual response) - lowered threshold for short answers
        const proseEls = [...document.querySelectorAll('[class*="prose"]')];
        const hasProseContent = proseEls.some(el => {
          const text = el.innerText.trim();
          // Must have some content, not just UI text (lowered from 50 to 15 for short answers)
          return text.length > 15 && !text.startsWith('Library') && !text.startsWith('Discover');
        });

        // Check if input is focused (user might be typing, not agent working)
        const inputFocused = document.activeElement?.matches('[contenteditable], textarea, input');

        const workingPatterns = [
          'Working', 'Searching', 'Reviewing sources', 'Preparing to assist',
          'Clicking', 'Typing:', 'Navigating to', 'Reading', 'Analyzing',
          'Browsing', 'Looking at', 'Checking', 'Opening', 'Scrolling',
          'Waiting', 'Processing'
        ];
        const hasWorkingText = workingPatterns.some(p => body.includes(p));

        // Determine status with improved logic
        let status = 'idle';

        // FIRST: Check if actively working (stop button is the strongest indicator)
        if (hasActiveStopButton) {
          status = 'working';
        } else if (hasLoadingSpinner || hasThinkingIndicator) {
          status = 'working';
        }
        // SECOND: Check completion indicators BEFORE working text
        // (because completed pages still show historical step text)
        else if (hasStepsCompleted || hasFinishedMarker) {
          status = 'completed';
        } else if (hasAskFollowUp && hasProseContent) {
          status = 'completed';
        } else if (hasSourcesIndicator && hasProseContent && !hasActiveStopButton) {
          status = 'completed';
        } else if (hasReviewedSources && !hasActiveStopButton) {
          status = 'completed';
        }
        // THIRD: Fall back to working text patterns (only if no completion signals)
        else if (hasWorkingText) {
          status = 'working';
        }

        // Extract steps
        const steps = [];
        const stepPatterns = [
          /Preparing to assist[^\\n]*/g, /Clicking[^\\n]*/g, /Typing:[^\\n]*/g,
          /Navigating[^\\n]*/g, /Reading[^\\n]*/g, /Searching[^\\n]*/g, /Found[^\\n]*/g
        ];
        for (const pattern of stepPatterns) {
          const matches = body.match(pattern);
          if (matches) steps.push(...matches.map(s => s.trim().substring(0, 100)));
        }

        // Extract response - get the FULL FINAL response after agent completes
        let response = '';
        if (status === 'completed') {
          const mainContent = document.querySelector('main') || document.body;
          const bodyText = mainContent.innerText;

          // Strategy 1: Find content after "X steps completed" marker (agent's final response)
          const stepsMatch = bodyText.match(/(\\d+)\\s*steps?\\s*completed/i);
          if (stepsMatch) {
            const markerIndex = bodyText.indexOf(stepsMatch[0]);
            if (markerIndex !== -1) {
              // Get everything after the marker
              let afterMarker = bodyText.substring(markerIndex + stepsMatch[0].length).trim();

              // Remove the ">" or arrow that often follows
              afterMarker = afterMarker.replace(/^[>›→\\s]+/, '').trim();

              // Find where the response ends (before input area or UI elements)
              const endMarkers = ['Ask anything', 'Ask a follow-up', 'Add details', 'Type a message'];
              let endIndex = afterMarker.length;
              for (const marker of endMarkers) {
                const idx = afterMarker.indexOf(marker);
                if (idx !== -1 && idx < endIndex) {
                  endIndex = idx;
                }
              }

              response = afterMarker.substring(0, endIndex).trim();
            }
          }

          // Strategy 2: If no steps marker, look for content after source citations
          if (!response || response.length < 50) {
            const sourcesMatch = bodyText.match(/Reviewed\\s+\\d+\\s+sources?/i);
            if (sourcesMatch) {
              const markerIndex = bodyText.indexOf(sourcesMatch[0]);
              if (markerIndex !== -1) {
                let afterMarker = bodyText.substring(markerIndex + sourcesMatch[0].length).trim();
                const endMarkers = ['Ask anything', 'Ask a follow-up', 'Add details'];
                let endIndex = afterMarker.length;
                for (const marker of endMarkers) {
                  const idx = afterMarker.indexOf(marker);
                  if (idx !== -1 && idx < endIndex) endIndex = idx;
                }
                response = afterMarker.substring(0, endIndex).trim();
              }
            }
          }

          // Strategy 3: Fallback - get all prose content combined
          if (!response || response.length < 50) {
            const allProseEls = [...mainContent.querySelectorAll('[class*="prose"]')];
            const validTexts = allProseEls
              .filter(el => {
                if (el.closest('nav, aside, header, footer, form, [contenteditable]')) return false;
                const text = el.innerText.trim();
                const isUIText = ['Library', 'Discover', 'Spaces', 'Finance', 'Account',
                                  'Upgrade', 'Home', 'Search'].some(ui => text.startsWith(ui));
                return !isUIText && text.length > 30;
              })
              .map(el => el.innerText.trim());

            // Combine all valid prose texts, taking the last/most recent ones
            if (validTexts.length > 0) {
              // Take last 3 prose blocks max (most recent response)
              response = validTexts.slice(-3).join('\\n\\n');
            }
          }

          // Clean up response - preserve formatting but remove UI artifacts
          if (response) {
            response = response
              .replace(/View All/gi, '')
              .replace(/Show more/gi, '')
              .replace(/Ask a follow-up/gi, '')
              .replace(/Ask anything\\.*/gi, '')
              .replace(/Add details to this task\\.*/gi, '')
              .replace(/\\d+\\s*sources?\\s*$/gi, '')
              .replace(/[\\u{1F300}-\\u{1F9FF}]/gu, '') // Remove most emojis from UI
              .replace(/^[>›→\\s]+/gm, '') // Remove leading arrows
              .replace(/\\n{3,}/g, '\\n\\n') // Collapse multiple newlines
              .trim();
          }
        }

        return {
          status,
          steps: [...new Set(steps)].slice(-5),
          currentStep: steps.length > 0 ? steps[steps.length - 1] : '',
          response: response.substring(0, 8000),
          hasStopButton: hasActiveStopButton
        };
      })()
    `);

    const statusResult = result.result.value as {
      status: "idle" | "working" | "completed";
      steps: string[];
      currentStep: string;
      response: string;
      hasStopButton: boolean;
    };

    // Check response stability
    const isStable = this.isResponseStable(statusResult.response);

    // If response is stable and has content, override status to completed
    if (isStable && statusResult.response.length > 50 && !statusResult.hasStopButton) {
      statusResult.status = 'completed';
    }

    return {
      ...statusResult,
      agentBrowsingUrl,
      isStable,
    };
  }

  // Independent stability tracker for sidecar — lower threshold than main
  // because sidecar answers can be very short (e.g. a single number).
  private sidecarLastResponse: string = '';
  private sidecarStableCount: number = 0;
  private readonly SIDECAR_STABILITY_THRESHOLD: number = 2;

  // Pre-submit count of answer-prose elements (those with class prose-str…).
  // Used to ignore old conversation history when extracting the current turn's answer.
  // Set by index.ts before calling sendPrompt — see setSidecarBaseline().
  private sidecarBaseline: number = 0;

  private isSidecarResponseStable(current: string): boolean {
    if (!current || current.length < 2) return false;
    if (current === this.sidecarLastResponse) {
      this.sidecarStableCount++;
    } else {
      this.sidecarStableCount = 0;
      this.sidecarLastResponse = current;
    }
    return this.sidecarStableCount >= this.SIDECAR_STABILITY_THRESHOLD;
  }

  /**
   * Capture the count of answer-prose elements before submitting a new prompt.
   * Sidecar accumulates conversation history in DOM; without a baseline we'd
   * read the previous answer as "the current response" and immediately mark
   * the task completed. Caller must invoke this just before sendPrompt.
   */
  async setSidecarBaseline(): Promise<number> {
    const r = await cometClient.evaluate(`
      document.querySelectorAll('[class*="prose-str"]').length
    `);
    this.sidecarBaseline = (r.result.value as number) || 0;
    return this.sidecarBaseline;
  }

  /**
   * Sidecar-specific status detector. Distinguishes answer prose (class includes
   * `prose-str…`) from step-card prose (different chrome) by class name only —
   * both share the generic `[class*="prose"]` selector but only answer turns
   * carry the `prose-str…` modifier. Filtered by pre-submit baseline so old
   * conversation history doesn't pollute the current turn's response.
   *
   * Also detects the "Let Assistant control your browser?" consent dialog and
   * extracts visible step labels (Navigating/Clicking/etc.) as progress.
   */
  private async getSidecarStatus() {
    const baseline = this.sidecarBaseline;
    const result = await cometClient.safeEvaluate(`
      (() => {
        // Stop button (strongest "working" signal)
        let hasActiveStopButton = false;
        for (const btn of document.querySelectorAll('button')) {
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          const hasStopRect = btn.querySelector('svg rect') !== null;
          if ((ariaLabel.includes('stop') || ariaLabel.includes('cancel') || hasStopRect) &&
              btn.offsetParent !== null && !btn.disabled) {
            hasActiveStopButton = true;
            break;
          }
        }

        const hasSpinner = document.querySelector('[class*="animate-spin"], [class*="animate-pulse"]') !== null;

        // Consent dialog — Comet's "Let Assistant control your browser?" guardrail
        let awaitingConsent = false;
        const bodyText = document.body.innerText;
        if (/Let Assistant control your browser/i.test(bodyText) ||
            /Allow Assistant to control/i.test(bodyText)) {
          // Confirm an Allow-once button is actually clickable (not stale text)
          for (const btn of document.querySelectorAll('button')) {
            const t = (btn.innerText || '').trim().toLowerCase();
            if (t === 'allow once' && btn.offsetParent !== null && !btn.disabled) {
              awaitingConsent = true;
              break;
            }
          }
        }

        // Answer prose: only [class*="prose-str"] elements (per probe — distinguishes
        // answer turns from action-step prose like "Clicking", "Navigating")
        const answerProse = [...document.querySelectorAll('[class*="prose-str"]')];
        const totalAnswers = answerProse.length;
        // New answers only (after pre-submit baseline)
        const newAnswers = answerProse.slice(${baseline});
        const responseFull = newAnswers.map(el => el.innerText.trim()).filter(t => t.length > 0).join('\\n\\n');

        // Step labels for progress visibility — Comet's UI shows section headers
        // for actions in progress: "Navigating", "Reading", "Clicking", "Interacting".
        // These live in elements ahead of the answer prose. Scan recent body text.
        const stepKeywords = ['Navigating', 'Reading', 'Clicking', 'Interacting', 'Searching', 'Analyzing', 'Opening', 'Reviewing', 'Preparing to assist', 'Typing'];
        const recentSteps = [];
        const lines = bodyText.split('\\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (line.length > 80) continue;
          for (const kw of stepKeywords) {
            if (line === kw || line.startsWith(kw + ' ')) {
              recentSteps.push(line.substring(0, 80));
              break;
            }
          }
        }
        const uniqueSteps = [...new Set(recentSteps)].slice(-8);

        let status = 'idle';
        if (awaitingConsent) {
          status = 'awaiting_consent';
        } else if (hasActiveStopButton || hasSpinner) {
          status = 'working';
        } else if (responseFull.length > 0) {
          // Promoted to 'completed' by stability check in caller
          status = 'working';
        }

        return {
          status,
          response: responseFull,
          hasActiveStopButton,
          awaitingConsent,
          totalAnswers,
          newAnswerCount: newAnswers.length,
          steps: uniqueSteps,
          currentStep: uniqueSteps[uniqueSteps.length - 1] || '',
        };
      })()
    `);

    const r = result.result.value as {
      status: "idle" | "working" | "awaiting_consent";
      response: string;
      hasActiveStopButton: boolean;
      awaitingConsent: boolean;
      totalAnswers: number;
      newAnswerCount: number;
      steps: string[];
      currentStep: string;
    };

    const isStable = this.isSidecarResponseStable(r.response);

    let status: "idle" | "working" | "completed" | "awaiting_consent" = r.status;
    if (status !== "awaiting_consent" && isStable && r.response.length > 0 && !r.hasActiveStopButton) {
      status = "completed";
    }

    return {
      status: status as "idle" | "working" | "completed",
      awaitingConsent: r.awaitingConsent,
      steps: r.steps,
      currentStep: r.currentStep,
      response: r.response.substring(0, 8000),
      hasStopButton: r.hasActiveStopButton,
      agentBrowsingUrl: "",
      isStable,
    };
  }

  /**
   * Stop the current agent task
   */
  async stopAgent(): Promise<boolean> {
    const result = await cometClient.evaluate(`
      (() => {
        // Try aria-label buttons first
        for (const btn of document.querySelectorAll('button[aria-label*="Stop"], button[aria-label*="Cancel"]')) {
          btn.click();
          return true;
        }
        // Try square stop icon
        for (const btn of document.querySelectorAll('button')) {
          if (btn.querySelector('svg rect')) {
            btn.click();
            return true;
          }
        }
        return false;
      })()
    `);
    return result.result.value as boolean;
  }
}

export const cometAI = new CometAI();
