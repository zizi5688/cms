# CMS Chrome Profiles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build standalone TypeScript scripts that create and manage a CMS-only Chrome user-data-dir, guide Xiaohongshu account login per isolated profile, and verify those profiles can be controlled through Puppeteer pipe mode without interfering with the user's normal Chrome.

**Architecture:** Keep all logic under `scripts/` and persist state only in `~/chrome-cms-data/cms-accounts.json`. Reuse shared helpers for Chrome paths, singleton inspection, login-state detection, and add CMS-specific helpers for account config creation, incremental updates, nickname validation, prompt input, and static version/profile checks.

**Tech Stack:** Node.js, TypeScript, Puppeteer, Node built-in `node:test`, macOS Chrome, file-based JSON config.

---

### Task 1: Extend Shared Helpers For CMS Profile Management

**Files:**
- Modify: `scripts/chrome-profile-utils.ts`
- Modify: `scripts/chrome-profile-utils.test.mjs`

**Step 1: Write the failing tests**

- Add tests for CMS data dir and config path helpers.
- Add tests for incremental profile generation with `--count`.
- Add tests for preserving existing login state and nickname when setup reruns.
- Add tests for nickname validation requiring non-empty input.
- Add tests for CMS singleton lock inspection against a custom user-data-dir path.

**Step 2: Run test to verify it fails**

Run: `node --test scripts/chrome-profile-utils.test.mjs`

Expected: FAIL because CMS config helpers do not exist yet.

**Step 3: Write minimal implementation**

- Add helpers for:
  - `~/chrome-cms-data` path resolution
  - `cms-accounts.json` path resolution
  - CMS profile row/config types
  - incremental profile list generation
  - config load/save helpers
  - nickname validation

**Step 4: Run test to verify it passes**

Run: `node --test scripts/chrome-profile-utils.test.mjs`

Expected: PASS.

### Task 2: Implement CMS Profile Setup Script

**Files:**
- Create: `scripts/setup-cms-profiles.ts`
- Reuse: `scripts/chrome-profile-utils.ts`

**Step 1: Write minimal implementation**

- Accept `--count N` with default `10`.
- Ensure `~/chrome-cms-data/` exists.
- If `~/chrome-profiles.json` is missing, reuse the existing default-profile enumeration logic to create it.
- Create or incrementally update `cms-accounts.json`.
- Print the created/preserved profiles summary and the required follow-up login hint.

**Step 2: Run script to verify it works**

Run: `node scripts/setup-cms-profiles.ts --count 3`

Expected: `~/chrome-cms-data/` and `cms-accounts.json` exist with 3 profile entries.

### Task 3: Implement Single-Profile Login Guide Script

**Files:**
- Create: `scripts/cms-login.ts`
- Reuse: `scripts/chrome-profile-utils.ts`

**Step 1: Write minimal implementation**

- Accept `--profile "cms-profile-X"`.
- Launch system Chrome with:
  - `userDataDir=~/chrome-cms-data`
  - `--profile-directory=cms-profile-X`
  - `pipe: true`
  - `headless: false`
- Open Xiaohongshu creator center.
- Print clear prompts including the current profile id.
- Wait for terminal Enter.
- Validate login state and require a non-empty nickname on success.
- Update `cms-accounts.json`.

**Step 2: Manual verification**

Run: `node scripts/cms-login.ts --profile "cms-profile-1"`

Expected: user can log in manually and saved state is written back.

### Task 4: Implement Silent Verification Script

**Files:**
- Create: `scripts/verify-cms-profile.ts`
- Reuse: `scripts/chrome-profile-utils.ts`

**Step 1: Write minimal implementation**

- Accept `--profile "cms-profile-X"`.
- Check singleton markers inside `~/chrome-cms-data/`.
- Launch Chrome with `pipe: true` against the CMS data dir.
- Minimize or move off-screen.
- Open `chrome://version` and print `Profile Path` + `User Data Dir`.
- Open Xiaohongshu creator center and print login verdict.
- Wait 3 seconds then close.

**Step 2: Manual verification**

Run: `node scripts/verify-cms-profile.ts --profile "cms-profile-1"`

Expected: `Profile Path` resolves inside `~/chrome-cms-data/cms-profile-1`, `User Data Dir` resolves to `~/chrome-cms-data`, and login status is printed.

### Task 5: Implement Batch Login Guide Script

**Files:**
- Create: `scripts/cms-login-all.ts`
- Reuse: `scripts/chrome-profile-utils.ts`

**Step 1: Write minimal implementation**

- Read `cms-accounts.json`.
- Select `xhsLoggedIn === false` profiles.
- Run the single-profile login flow one by one.
- Print per-profile progress such as `正在为 cms-profile-3 登录，请在浏览器中操作`.
- Print final summary.

**Step 2: Manual verification**

Run: `node scripts/cms-login-all.ts`

Expected: profiles are prompted sequentially and summary prints at the end.

### Task 6: End-to-End Verification

**Files:**
- Existing files touched in Tasks 1-5

**Step 1: Run focused tests**

Run: `node --test scripts/chrome-profile-utils.test.mjs`

Expected: PASS.

**Step 2: Run script type check**

Run: `npx tsc --noEmit -p tsconfig.scripts.json`

Expected: PASS.

**Step 3: Run real scripts**

Run:
- `node scripts/setup-cms-profiles.ts --count 3`
- `node scripts/cms-login.ts --profile "cms-profile-1"`
- `node scripts/verify-cms-profile.ts --profile "cms-profile-1"`

Expected:
- CMS-only data dir created
- login state saved under CMS-only profile
- verification succeeds even when normal Chrome is open
