---
name: phase-release-loop
description: Use when the user asks for Mac end-of-phase release closeout, including commit/push, merge to main, DMG build/install, GitHub Release publication for mac remote update, app relaunch, or post-release cleanup.
---

# Phase Release Loop

## Goal

Run a deterministic Mac release loop while keeping the source workspace safe and the repository tidy:

1. validate and commit the source branch
2. push the source branch
3. merge through an isolated temporary release worktree
4. push the merge result to `main`
5. build the mac release artifacts needed for both local install and remote update
6. publish the mac remote-update artifacts to GitHub Releases
7. copy the final DMG back to the repo-root `release/` directory
8. install over `/Applications/Super CMS.app`
9. relaunch and report
10. refresh a local `main` checkout so this machine's `main` also stays current
11. clean up temporary release branches/worktrees and merged local `codex/` branches that are no longer active

## Required Inputs

Before execution, confirm these values (infer reasonable defaults when omitted):

1. commit scope paths
2. bilingual commit message in format `type: 中文 / English`
3. source branch (default: current branch)
4. target branch (default: `main`)
5. whether to stop on merge conflict (default: yes)
6. whether to remove temporary release worktree after success (default: yes)
7. whether to delete the temporary remote release branch after success (default: yes)
8. whether to delete merged local `codex/` branches that are not checked out in any worktree (default: yes for “收尾” / “阶段收尾” style requests)

## Workflow

### 1) Baseline Inspection

Run:

```bash
git status --short
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name @{u}
git worktree list
```

Rules:

1. If current branch is `main`, stop and ask whether to create/switch branch first.
2. If the source workspace has unrelated dirty files, explicitly ask whether to include them; do not auto-stage all.
3. Prefer a temporary release worktree under `.worktrees/` so merge/build/install work never disturbs the source workspace.
4. If unrelated dirty files must be protected during release, use a named stash and report it clearly.
5. Record which branches are currently attached to worktrees; treat them as active branches during cleanup.

### 2) Validation Gate

Run repository checks before commit:

```bash
npm run typecheck
```

When relevant, add targeted lint/tests for touched modules.

If validation fails, stop and report the first failing command and a short summary.

### 3) Commit Gate

Stage only approved files:

```bash
git add <approved-paths>
git diff --cached --stat
```

Then ask one explicit confirmation:

`是否现在提交这个节点？`

Only after approval:

```bash
git commit -m "feat|fix|refactor|chore: 中文说明 / English summary"
git push origin <source-branch>
```

### 4) Create Temporary Release Worktree

Do merge/build/publish work in an isolated release worktree instead of the source workspace:

```bash
git fetch origin
git worktree add ".worktrees/release-main-phase-loop-$(date +%Y%m%d-%H%M%S)" -b "codex/release-main-phase-loop-$(date +%Y%m%d-%H%M%S)" origin/main
```

Rules:

1. Use the release worktree as the only place for merge, build, packaging, and install.
2. Do not mix release actions into a dirty feature worktree.
3. Report the full release worktree path before continuing.
4. If the release worktree has no `node_modules`, reuse the repo-root dependency directory (for example by symlink) before building.

### 5) Merge To Main Through Release Worktree

Inside the release worktree, run:

```bash
git fetch origin
git merge --no-ff <source-branch>
```

Rules:

1. On merge conflict, stop immediately by default and report conflicted files.
2. If the user explicitly asks to continue resolving conflicts, keep one clear strategy, resolve manually, then rerun `npm run typecheck` before pushing.
3. Commit the merge in the release worktree with a bilingual message.
4. Push the temporary release branch first:

```bash
git push origin <release-branch>
```

5. Then push to `main`:

```bash
git push origin <release-branch>:main
```

6. If repository governance blocks direct push to `main` but the user explicitly requested the full release loop, use the repo-provided bypass instead of force-push or rebase. Example:

```bash
ALLOW_MAIN_PUSH=1 git push origin <release-branch>:main
```

7. Never use rebase, force-push, or history rewrite unless the user explicitly requests it.

### 6) Build macOS Release Artifacts From Release Worktree

Use the project standard build first:

```bash
npm run build:mac
```

Then locate the newest DMG in the release worktree:

```bash
ls -t release/*.dmg | head -n 1
```

Rules:

1. Build inside the release worktree, not the source worktree.
2. The build must produce both the maintainer-facing DMG and the updater-facing macOS release files required for GitHub Releases remote update.
3. Verify the release directory contains the mac updater metadata file (for example `latest-mac.yml`) before continuing.
4. If the full build already produced app artifacts but DMG creation failed, it is acceptable to rerun only the packaging step:

```bash
npm exec electron-builder -- --mac --config electron-builder.json
```

5. If sandboxing blocks `hdiutil` or DMG creation, rerun the packaging step with escalation instead of changing build logic.
6. If the repository's mac publish script already performs build + verify + publish in one command, it is acceptable to use that single command as the authoritative build/publish step and reuse the emitted artifacts for local install, instead of rebuilding twice.

### 7) Publish macOS Remote-Update Artifacts

After local mac release artifacts exist, publish the updater-compatible macOS files to GitHub Releases using the project's standard publish path.

Preferred command shape:

```bash
npm run publish:mac
```

If the repo uses a script directly, use that exact script instead.

Rules:

1. Remote publication is a required step for Mac remote-update support, not an optional postscript.
2. Stop immediately if GitHub publication fails. Do not report the release as complete if only the local DMG exists.
3. Confirm that the macOS updater metadata and downloadable artifact were included in the published release.
4. Report the tag/version that was published.
5. If the publish script already includes the build, do not rerun a separate full packaging step unless the user explicitly wants an additional local-only verification build.

### 8) Copy Artifact Back To Canonical Repo Path

The user-facing DMG should always be copied back to the repo-root `release/` directory:

```bash
mkdir -p "<repo-root>/release"
ditto "<release-worktree>/release/<latest>.dmg" "<repo-root>/release/<latest>.dmg"
```

Rules:

1. Always report the repo-root path as the primary artifact path.
2. Do not make the user dig inside hidden `.worktrees/` paths to find the installer.

### 9) Install And Replace App

Mount the DMG, detect the mounted `.app`, copy it into `/Applications`, then detach:

```bash
DMG_PATH="<repo-root>/release/<latest>.dmg"
ATTACH_OUTPUT="$(hdiutil attach "$DMG_PATH" -nobrowse)"
VOLUME_PATH="<parse full /Volumes/... path from attach output>"
APP_PATH="$(find "$VOLUME_PATH" -maxdepth 1 -name '*.app' | head -n 1)"
ditto "$APP_PATH" "/Applications/Super CMS.app"
hdiutil detach "$VOLUME_PATH"
```

Rules:

1. Do not assume the mounted volume path has no spaces.
2. Do not parse the mount path with `awk '{print $3}'`; it breaks on names like `/Volumes/Super CMS 1.0.13-arm64`.
3. If app bundle name differs, detect `*.app` dynamically.
4. Never delete the old app manually before copy unless the user explicitly asks.

### 10) Relaunch App

```bash
pkill -f "/Applications/Super CMS.app/Contents/MacOS/Super CMS" || true
open "/Applications/Super CMS.app"
pgrep -fal "/Applications/Super CMS.app/Contents/MacOS/Super CMS"
```

If process check fails, report the reason and provide a manual-open fallback.

### 11) Refresh Local Main After Release

After the release branch has been pushed to `main`, the DMG has been installed, and the app has been relaunched, refresh a local `main` checkout so future work does not start from a stale local branch.

Preferred order:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
```

Rules:

1. Do this in a clean `main` checkout or an existing `main` worktree, not in a dirty feature workspace.
2. If the current checkout cannot safely switch to `main`, use an existing clean `main` worktree and run the same fast-forward there.
3. If no safe `main` checkout is available, stop and report which workspace blocked the refresh instead of risking local changes.
4. Report the exact path where local `main` was refreshed.

### 12) Default Cleanup After Successful Release

After `main` is refreshed, perform cleanup by default for stage-closeout requests:

```bash
git push origin --delete <release-branch>
git worktree remove "<release-worktree>"
git worktree prune
```

Rules:

1. Delete the temporary remote release branch after `main` has been updated successfully.
2. Remove the temporary release worktree after all build/install steps are complete.
3. Delete merged local `codex/` branches that are not checked out in any worktree; keep `main` and every branch currently attached to a worktree.
4. If a branch is merged into `main` but `git branch -d` refuses only because it is not merged to its old upstream, and the user explicitly asked for cleanup, `git branch -D` is acceptable for that branch.
5. If the source feature branch is still attached to a live worktree or that worktree has ongoing local changes, keep it and report why it was retained instead of switching the user's workspace behind their back.
6. Do not silently delete stashes or active worktrees.

### 13) Optional Extended Cleanup

If the user explicitly asks for deeper repo cleanup, also:

1. delete older merged local `codex/` release branches that are no longer active
2. report retained active branches and why they were kept
3. call out any named stash entries created during protection

## Common Pitfalls

1. `electron-builder` cannot detect Electron version in a release worktree:
   - likely cause: release worktree is missing `node_modules`
   - fix: reuse repo-root `node_modules` or install dependencies in the release worktree
2. `hdiutil: create failed` during DMG build:
   - likely cause: sandbox restriction or environment-level DMG creation failure
   - fix: rerun the packaging step with escalation
3. mac remote-update artifacts missing after build:
   - likely cause: mac target only produced DMG, or updater metadata generation was not configured
   - fix: verify the mac build emits updater-compatible artifacts and confirm `latest-mac.yml` exists before publish
4. GitHub publication fails after local DMG build succeeds:
   - likely cause: auth, release-tag mismatch, or publish script failure
   - fix: stop the loop, report the exact publish command and error, and do not claim remote update readiness
5. mounted volume path parse fails:
   - likely cause: volume name contains spaces
   - fix: capture the full `/Volumes/...` path, then `find` the `.app`
6. DMG exists but user cannot find it:
   - likely cause: build happened in a hidden release worktree
   - fix: always copy the final DMG back to `<repo-root>/release/`
7. cleanup wants to delete the current feature branch:
   - likely cause: that branch is still the active source workspace
   - fix: keep the branch, report it as retained, and only delete inactive merged branches

## Final Report Template

Return a concise release report with:

1. source commit hash and message
2. release merge commit hash and message
3. pushed source branch, release branch, and merge target
4. validation result (`npm run typecheck`, plus anything extra)
5. mac remote-update publish result (command, tag/version, success/failure)
6. DMG path in the release worktree
7. canonical DMG path in `<repo-root>/release/`
8. install result (`/Applications/Super CMS.app`)
9. relaunch process status (PID or failure reason)
10. local `main` refresh status and path
11. cleanup status for the temporary release branch/worktree, deleted merged local branches, and any retained active branches

## Safety Rules

1. Keep `git-governance` constraints active: explicit commit confirmation and bilingual commit messages.
2. Do not run destructive git commands (`reset --hard`, force-push, rebase, branch deletion, worktree deletion) without user approval.
3. On any failed critical step, stop chain execution and report exactly where it failed.
4. Prefer temporary release worktrees for isolation; prefer repo-root `release/` as the final artifact path.
