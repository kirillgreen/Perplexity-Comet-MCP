// Target mode — switches between Perplexity main app and Comet Assistant sidecar.
// Read once at module init from COMET_TARGET env var. Default: 'main' (preserves upstream behaviour).

export type TargetMode = "main" | "sidecar";

const raw = (process.env.COMET_TARGET || "main").trim().toLowerCase();
export const TARGET: TargetMode = raw === "sidecar" ? "sidecar" : "main";

export const PERPLEXITY_MAIN_URL = "https://www.perplexity.ai/";
export const PERPLEXITY_SIDECAR_URL = "https://www.perplexity.ai/sidecar";

export const TARGET_URL = TARGET === "sidecar" ? PERPLEXITY_SIDECAR_URL : PERPLEXITY_MAIN_URL;

// Is this URL the active target?
export function isTargetUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (TARGET === "sidecar") return url.includes("/sidecar");
  // main: perplexity.ai but NOT sidecar
  return url.includes("perplexity.ai") && !url.includes("/sidecar");
}

// Pick the right tab from listTabsCategorized output
export function pickTargetTab<T extends { main: any; sidecar: any }>(tabs: T): T["main"] | T["sidecar"] {
  return TARGET === "sidecar" ? tabs.sidecar : tabs.main;
}
