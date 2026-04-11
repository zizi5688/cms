# Chrome Profile Pipe Launcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add standalone Node.js scripts under `scripts/` that enumerate local Chrome profiles and verify a specific Chrome profile can be launched through Puppeteer pipe mode while preserving Xiaohongshu creator login state.

**Architecture:** Keep all behavior isolated to new script files and a script-only TypeScript config. Parse Chrome profile metadata from `Local State`, share pure helpers for CLI/profile resolution/login checks, and use one runtime launcher script to start system Chrome with `pipe: true`, validate the effective profile path through `chrome://version`, then inspect Xiaohongshu creator login state before closing.

**Tech Stack:** Node.js, TypeScript, Puppeteer, Node built-in `node:test`, macOS Chrome profile files.

---

### Task 1: Add Script-Only TypeScript Scaffolding And Pure Helper Tests

**Files:**
- Create: `tsconfig.scripts.json`
- Create: `scripts/chrome-profile-utils.ts`
- Create: `scripts/chrome-profile-utils.test.mjs`

**Step 1: Write the failing tests**

- Add tests for parsing `profile.info_cache` from a Local State JSON payload.
- Add tests for resolving a requested profile directory to its absolute profile path.
- Add tests for CLI argument parsing for `--profile`.
- Add tests for the login-result helper that distinguishes session cookie present vs login redirect.

**Step 2: Run test to verify it fails**

Run: `node --test scripts/chrome-profile-utils.test.mjs`

Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

- Add pure helpers for:
  - Chrome constants (`userDataDir`, `localStatePath`, `singletonLockPath`, `chromeExecutablePath`)
  - Local State profile parsing
  - fixed-width table rendering
  - `--profile` CLI parsing
  - login-state summarization from URL + cookies

**Step 4: Run test to verify it passes**

Run: `node --test scripts/chrome-profile-utils.test.mjs`

Expected: PASS.

### Task 2: Implement Chrome Profile Enumeration Script

**Files:**
- Create: `scripts/list-chrome-profiles.ts`
- Reuse: `scripts/chrome-profile-utils.ts`

**Step 1: Write the minimal script**

- Read `~/Library/Application Support/Google/Chrome/Local State`.
- Parse `profile.info_cache`.
- Print a terminal table with:
  - profile directory name
  - nickname
  - full path
- Write JSON output to `~/chrome-profiles.json`.

**Step 2: Run script to verify it works**

Run: `npx tsx scripts/list-chrome-profiles.ts`

Expected: terminal table printed and `~/chrome-profiles.json` created.

### Task 3: Implement Chrome Profile Pipe Launcher Script

**Files:**
- Create: `scripts/chrome-profile-launcher.ts`
- Reuse: `scripts/chrome-profile-utils.ts`

**Step 1: Write the minimal script**

- Parse `--profile`.
- Check `SingletonLock` before launch and exit with the required Chinese error if present.
- Launch Puppeteer with:
  - `executablePath` set to system Chrome
  - `userDataDir` set to Chrome user-data-dir
  - `args` containing `--profile-directory=<dir>`
  - `pipe: true`
  - `headless: false`
  - `defaultViewport: null`
- Move the browser window off-screen through CDP, or minimize if off-screen positioning fails.
- Read `chrome://version` and print `Profile Path`.
- Open `https://creator.xiaohongshu.com`, inspect cookies + final URL, and print login status.
- Wait 5 seconds and close the browser.

**Step 2: Run launcher with a real profile**

Run: `npx tsx scripts/chrome-profile-launcher.ts --profile "Profile 3"`

Expected: `Profile Path` matches the requested profile directory and login-state output is printed.

### Task 4: Verification And Usage Notes

**Files:**
- Existing files touched in Tasks 1-3

**Step 1: Run focused tests**

Run: `node --test scripts/chrome-profile-utils.test.mjs`

Expected: PASS.

**Step 2: Run script type check**

Run: `npx tsc --noEmit -p tsconfig.scripts.json`

Expected: PASS.

**Step 3: Run real-world validation**

Run:
- `npx tsx scripts/list-chrome-profiles.ts`
- `npx tsx scripts/chrome-profile-launcher.ts --profile "<one profile dir>"`

Expected:
- profile table prints successfully
- `~/chrome-profiles.json` exists
- launcher prints the effective `Profile Path`
- launcher reports whether Xiaohongshu creator session is still logged in
- launcher exits cleanly after 5 seconds
