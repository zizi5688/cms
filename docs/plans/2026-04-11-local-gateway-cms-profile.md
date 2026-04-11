# Local Gateway CMS Profile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move Local Gateway onto a dedicated CMS-managed Chrome profile so app startup and gateway initialization never touch the user's daily Chrome profiles.

**Architecture:** Reuse `~/chrome-cms-data/cms-accounts.json` as the source of truth for managed automation profiles. Extend the CMS profile model with a purpose field, add gateway-specific helpers for provisioning and login, then switch Local Gateway settings/runtime from system Chrome profile enumeration to CMS profile enumeration and launching.

**Tech Stack:** Electron, TypeScript, electron-store, Puppeteer, existing CMS Chrome launcher/helpers

---

### Task 1: Extend CMS profile types and helpers for gateway purpose

**Files:**
- Modify: `src/shared/cmsChromeProfileTypes.ts`
- Modify: `src/cdp/chrome-launcher.ts`

**Step 1: Add failing expectations in code comments/logic target**

Define the new shape up front:

```ts
type CmsChromeProfilePurpose = 'publisher' | 'gateway' | 'shared'
```

Ensure profile records can carry `purpose`.

**Step 2: Implement normalization**

- Read missing `purpose` as `publisher`
- Preserve existing records
- Add helper to ensure a gateway profile record exists

**Step 3: Add gateway-oriented read/list helpers**

- list all CMS profiles
- list gateway-eligible CMS profiles
- ensure `cms-gateway-profile`

**Step 4: Run verification**

Run: `npm run typecheck:node`
Expected: PASS

### Task 2: Refactor Local Gateway backend config to target CMS profiles

**Files:**
- Modify: `src/shared/localGatewayTypes.ts`
- Modify: `src/main/services/localGatewayConfig.ts`
- Modify: `src/main/services/localGatewayManager.ts`
- Modify: `src/main/services/localGatewayChromeProfiles.ts`

**Step 1: Replace legacy semantics**

Replace system Chrome profile selection with CMS gateway profile selection:

```ts
gatewayCmsProfileId: string
```

Keep backward compatibility by normalizing legacy `chromeProfileDirectory`.

**Step 2: Remove runtime dependency on system Chrome Local State**

- `listLocalGatewayChromeProfiles()` should return CMS-managed profiles instead
- legacy values should be flagged as migration-needed, not used for control

**Step 3: Update initialization/runtime**

- Local Gateway uses gateway CMS profile id
- startup refuses to touch daily Chrome when profile missing
- bootstrap env gets CMS profile dir and CMS user-data-dir

**Step 4: Run verification**

Run: `npm run typecheck:node`
Expected: PASS

### Task 3: Add gateway profile provisioning and login actions

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/cdp/chrome-launcher.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Step 1: Add IPC handlers**

- initialize gateway CMS profile
- open/login gateway CMS profile
- optionally verify gateway CMS profile

**Step 2: Reuse existing Chrome launcher logic**

- launch with `~/chrome-cms-data`
- `--profile-directory=cms-gateway-profile`
- no system Chrome interaction

**Step 3: Keep lifecycle safe**

- interactive login flow should not silently close user windows
- verify flow should cleanly close the launched browser

**Step 4: Run verification**

Run: `npm run typecheck:node`
Expected: PASS

### Task 4: Update Settings UI to manage gateway CMS profile

**Files:**
- Modify: `src/renderer/src/store/useCmsStore.ts`
- Modify: `src/renderer/src/components/modules/Settings.tsx`

**Step 1: Replace selector source**

- populate selector from CMS-managed profiles
- surface gateway profile purpose and login status

**Step 2: Add migration-safe actions**

- "初始化网关专用 Profile"
- "打开并登录网关 Profile"
- migration warning when legacy system profile config is detected

**Step 3: Update explanatory copy**

State clearly that Local Gateway now uses a CMS-managed dedicated profile and will not touch daily Chrome.

**Step 4: Run verification**

Run: `npm run typecheck:web`
Expected: PASS

### Task 5: End-to-end verification

**Files:**
- Modify if needed: `src/main/services/localGatewayManager.ts`
- Modify if needed: `src/renderer/src/components/modules/Settings.tsx`

**Step 1: Verify launch safety**

- launch app with Local Gateway enabled
- confirm no daily Chrome remote debugging consent prompt appears

**Step 2: Verify gateway initialization**

- initialize `cms-gateway-profile`
- open login window
- confirm it uses `~/chrome-cms-data`

**Step 3: Verify no publisher regression**

Run:

```bash
npm run typecheck:node
npm run typecheck:web
```

Expected: PASS

**Step 4: Commit checkpoint**

After user verification, ask:

```text
是否现在提交这个节点？
```
