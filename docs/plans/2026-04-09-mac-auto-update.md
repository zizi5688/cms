# Mac Auto Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add packaged macOS remote update support through the existing GitHub Releases feed, with background download plus install-on-quit or immediate restart, and update the Mac phase closeout release skill accordingly.

**Architecture:** Reuse the existing `electron-updater` service and IPC contract, expand runtime enablement from Windows-only to packaged Windows and packaged macOS, then make macOS packaging and release scripts emit and publish updater-compatible artifacts. Keep the phase-closeout skill aligned so a normal Mac release both installs locally and publishes remote-update artifacts.

**Tech Stack:** Electron, electron-updater, electron-builder, React, TypeScript, Node.js release scripts, local Codex skill docs

---

### Task 1: Audit Current Windows Update Flow and Mac Packaging Assumptions

**Files:**
- Modify: `docs/plans/2026-04-09-mac-auto-update-design.md`
- Inspect: `src/main/services/autoUpdate.ts`
- Inspect: `src/renderer/src/components/modules/Settings.tsx`
- Inspect: `electron-builder.json`
- Inspect: `scripts/release-win-x64.cjs`
- Inspect: `scripts/release-win-x64-ci.cjs`

**Step 1: Verify the runtime gates and updater IPC surface**

Run: `rg -n "app:update|autoUpdater|process.platform !== 'win32'|quitAndInstall" src/main/services/autoUpdate.ts src/renderer/src/components/modules/Settings.tsx`

Expected: references showing the current updater state machine, renderer controls, and the Windows-only gate.

**Step 2: Verify current macOS packaging targets**

Run: `cat electron-builder.json`

Expected: `mac.target` currently only contains `dmg`.

**Step 3: Verify Windows release publication shape**

Run: `sed -n '1,240p' scripts/release-win-x64.cjs && sed -n '1,240p' scripts/release-win-x64-ci.cjs`

Expected: release scripts that can be mirrored for macOS publication.

**Step 4: Update design notes if implementation reality differs**

Edit the design doc only if the actual code paths differ from the agreed design.

**Step 5: Commit**

Do not commit automatically. Bundle with the first implementation checkpoint if desired.

### Task 2: Make the Runtime Update Service Cross-Platform for Packaged macOS

**Files:**
- Modify: `src/main/services/autoUpdate.ts`
- Test: `src/main/services/autoUpdate*.test.*` if present, otherwise add focused tests in the nearest existing test file pattern

**Step 1: Write the failing test for update enablement**

Add tests that assert:
- packaged `win32` remains enabled
- packaged `darwin` becomes enabled
- development mode remains disabled

**Step 2: Run targeted tests to verify failure**

Run: `node --test <targeted auto update test file>`

Expected: FAIL on macOS packaged enablement before implementation.

**Step 3: Implement minimal runtime gate changes**

Change the service so packaged `darwin` is treated like packaged `win32`, while keeping non-packaged builds disabled.

**Step 4: Preserve downloaded-state behavior**

Ensure `update-downloaded` continues to:
- mark the state as downloaded
- offer immediate install
- keep install-on-quit intact for deferral

**Step 5: Run targeted tests again**

Run: `node --test <targeted auto update test file>`

Expected: PASS.

**Step 6: Commit**

Stage only updater service and tests after validation.

### Task 3: Update Settings UI for Cross-Platform Mac + Windows Update Messaging

**Files:**
- Modify: `src/renderer/src/components/modules/Settings.tsx`

**Step 1: Write the failing UI assertions or snapshot-level expectations**

Add targeted tests if this area already has a test harness. If not, document precise manual verification steps in the task notes and keep the code diff small.

**Step 2: Change labels from Windows-only to cross-platform**

Update:
- card title
- description
- disabled-state copy
- downloaded-state copy

Expected user copy must mention:
- background download
- immediate restart update
- install on quit when deferred

**Step 3: Verify local type safety**

Run: `npm run typecheck:web`

Expected: PASS.

**Step 4: Manually inspect the state mapping in code**

Run: `rg -n "应用更新|Windows|下载完成|退出时" src/renderer/src/components/modules/Settings.tsx`

Expected: all user-facing copy is cross-platform and consistent with the runtime behavior.

**Step 5: Commit**

Stage only Settings UI changes after validation.

### Task 4: Add macOS Updater-Compatible Packaging Outputs

**Files:**
- Modify: `electron-builder.json`
- Inspect: `package.json`

**Step 1: Write the packaging expectation down in comments or plan notes**

Record the required macOS outputs for `electron-updater` compatibility and ensure DMG remains available for local install.

**Step 2: Update mac target configuration**

Adjust `mac.target` so the build emits:
- the maintainer-friendly DMG
- the updater-compatible macOS artifact set required for GitHub Releases auto update

Keep existing Windows and Linux targets unchanged.

**Step 3: Run packaging config validation**

Run: `npm run verify:packaging-config`

Expected: PASS.

**Step 4: If validation requires a full packaged build, run the minimal necessary build command**

Run: `npm run build:app`

Expected: PASS before any full packaging attempt.

**Step 5: Commit**

Stage only packaging config updates after validation.

### Task 5: Add a macOS Release Publication Script

**Files:**
- Create: `scripts/release-mac.cjs` or `scripts/release-mac-arm64.cjs`
- Modify: `package.json`
- Optionally create: `scripts/release-mac-ci.cjs`

**Step 1: Write the failing script verification**

Define the expected script behavior:
- detect packaged mac artifacts
- verify updater metadata exists
- upload artifacts to the existing GitHub Release

**Step 2: Mirror the Windows release script structure**

Reuse the same command style, logging style, and failure style used by the Windows scripts.

**Step 3: Add package.json entries**

Add commands for local publish and CI-friendly publish if needed.

**Step 4: Dry-run script verification**

Run: `node scripts/release-mac.cjs --help` or the lightest supported validation entrypoint

Expected: script loads without syntax errors and reports expected usage or validation output.

**Step 5: Commit**

Stage only the new mac release script(s) and package command wiring.

### Task 6: Update the Local Phase Release Loop Skill

**Files:**
- Modify: `/Users/z/.codex/skills/phase-release-loop/SKILL.md`

**Step 1: Update the skill goal**

Change the release-loop goal so Mac closeout includes publishing macOS remote-update artifacts, not just local DMG install.

**Step 2: Update workflow steps**

Make the workflow explicitly include:
- building updater-compatible macOS release outputs
- publishing them to GitHub Releases
- reporting remote publication success before local install is considered complete

**Step 3: Update pitfalls and final report template**

Add mac remote-update specific pitfalls, such as:
- missing updater metadata
- GitHub release publication failure
- local install success but remote feed missing

**Step 4: Sanity-check the skill**

Run: `sed -n '1,260p' /Users/z/.codex/skills/phase-release-loop/SKILL.md`

Expected: the new workflow is internally consistent and still deterministic.

**Step 5: Commit**

Commit skill-doc changes only if you want the workflow update versioned with the app change set.

### Task 7: End-to-End Verification of macOS Remote Update Artifacts

**Files:**
- Inspect generated files under: `release/`

**Step 1: Build macOS artifacts**

Run: `npm run build:mac`

Expected: PASS, with DMG plus mac updater-compatible release files present.

**Step 2: Verify generated release files**

Run: `ls -la release`

Expected: DMG plus mac updater metadata/artifact set required for remote updates.

**Step 3: Run the mac release script against the generated outputs**

Run: `node scripts/release-mac.cjs`

Expected: the script validates and uploads the correct artifacts to the existing GitHub Release.

**Step 4: Verify remote update from a second packaged Mac client**

Manual verification:
- launch an older packaged Mac build
- wait for startup auto-check or trigger manual check
- confirm update available state
- allow background download
- confirm `立即重启更新` and deferred install-on-quit both behave correctly

**Step 5: Record any verification gaps**

If a second Mac client is not available in-session, note the exact unverified step before claiming completion.

**Step 6: Commit**

Create a final cohesive commit only after the full end-to-end flow is validated.
