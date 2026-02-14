---
name: xhs-dip
description: Xiaohongshu (RedNote) data interaction protocol for any task that writes, reviews, or refactors code that performs XHS network interaction, automation, scraping, or data ingestion. Use when changing Playwright/Puppeteer/Electron/WebView request flows, extracting XHS note or product data, or auditing anti-block and data-quality compliance before merge.
---

# XHS-DIP

## Prime Directive

Apply this protocol to every Xiaohongshu network task end-to-end.
After coding, run a mandatory self-audit against the checklist in this file.

## Workflow

1. Identify scope.
Treat tasks as in-scope when code touches XHS requests, browser automation, data extraction, or persistence.
2. Apply protocol rules during implementation.
Enforce identity camouflage, human-like pacing, and precision extraction in the same change.
3. Block unsafe data writes.
Detect soft-block artifacts before returning or persisting URLs.
4. Self-audit before completion.
Report pass/fail for each checklist item and fix failures.

## Protocol Rules

### 1) Identity Camouflage (The Chameleon Rule)

- Override User-Agent explicitly for every XHS browsing session.
- Never use default Electron/Chromium UA.
- Use this standard UA string unless the user gives a stronger requirement:
`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`
- Randomize viewport for each session in range `1280-1600` x `800-1000`.
- Never use fixed `1920x1080` or `800x600`.
- Allow CSS loading.
- Optionally block image/media resources for bandwidth control.

### 2) Human-Like Behavior (The Human-Like Rule)

- Insert jitter delay between consecutive requests.
- Use `Math.random()` driven sleep in `2s-5s` range by default.
- After `dom-ready`, wait `1s-2s` before extraction.
- Perform smooth scrolling (`window.scrollBy`) before scraping to simulate reading.
- Implement cooldown counter.
- After every `N` tasks (default `15`), enforce long rest `60s-90s`.

### 3) Data Precision and Anti-Poisoning (The Precision Rule)

- Prefer global state JSON as primary source.
- First attempt extraction from `window.__INITIAL_STATE__`.
- Use meta tags only as fallback and validate against expected fields.
- Run soft-block URL guard before returning any image URL.
- Treat values containing `logo`, `assets/img`, or `spacer` as blocked artifacts.
- On detection, throw a specific error such as `SOFT_BLOCK_DETECTED`.
- Never persist soft-block URLs to any database table.

## Implementation Patterns

Use these snippets as defaults and adapt to project style.

```ts
const XHS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function viewportForSession() {
  return { width: randomInt(1280, 1600), height: randomInt(800, 1000) }
}

async function jitterDelay(minMs = 2000, maxMs = 5000) {
  const ms = randomInt(minMs, maxMs)
  await new Promise((resolve) => setTimeout(resolve, ms))
}
```

```ts
function assertNotSoftBlocked(url: string): string {
  const lower = url.toLowerCase()
  if (lower.includes('logo') || lower.includes('assets/img') || lower.includes('spacer')) {
    throw new Error('SOFT_BLOCK_DETECTED')
  }
  return url
}
```

## Mandatory Self-Audit

Before final response, confirm all items:

1. [ ] Set a real non-default User-Agent.
2. [ ] Added random delay between requests.
3. [ ] Prioritized JSON/global state extraction over fragile DOM selectors.
4. [ ] Detected and handled logo/soft-block artifacts with explicit error.
5. [ ] Avoided high-frequency concurrent request patterns.

If any item fails, fix code first, then re-run the self-audit.
