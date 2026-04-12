---
name: phase-release-loop
description: Execute the end-of-phase desktop delivery loop in this repository. Use when the user asks for stage closeout or says “提交并推送”, “合并到 main”, “打包 DMG”, “覆盖安装旧版”, “重启应用”, or similar release-chain requests.
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
7. copy the final DMG back to the repo-root `release/` directory and prune stale local release artifacts
8. install over `/Applications/Super CMS.app`
9. relaunch and report
10. refresh a local `main` checkout so this machine's `main` also stays current
11. ask whether to switch any user-visible workspace back to `main`; default is no
12. clean up temporary release branches/worktrees and merged local `codex/` branches that are no longer active
13. use GitHub's latest published/tagged version as the release baseline, then explicitly ask the user which version to release before any version bump or publish step

## Required Inputs

Before execution, confirm these values (infer reasonable defaults when omitted):

1. latest GitHub version/tag (must be checked first; do not trust only local `package.json`)
2. target release version confirmed by the user after seeing the GitHub baseline
3. commit scope paths
4. bilingual commit message in format `type: 中文 / English`
5. source branch (default: current branch)
6. target branch (default: `main`)
7. whether to stop on merge conflict (default: yes)
8. whether to remove temporary release worktree after success (default: yes)
9. whether to delete the temporary remote release branch after success (default: yes)
10. whether to delete merged local `codex/` branches that are not checked out in any worktree (default: yes for “收尾” / “阶段收尾” style requests)

## Workflow

### 0) GitHub Version Baseline

Run before any commit/release version bump:

```bash
git remote -v
git ls-remote --tags --refs origin | sed 's#.*refs/tags/##' | sort -V | tail -n 20
```

Rules:

1. Treat GitHub tags/releases as the source of truth for the current published version.
2. Report the latest GitHub version to the user explicitly.
3. Ask one explicit question before touching version numbers:

`GitHub 当前最新版本是 <latest>，这次要更新到几？`

4. Do not auto-bump from local `package.json` alone.
5. Do not continue to merge/build/publish until the target version is confirmed by the user.

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
4. If the release worktree has no `node_modules`, reuse the repo-root dependency directory before building.

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

6. If repository governance blocks direct push to `main` but the user explicitly requested the full release loop, use the repo-provided bypass instead of force-push or rebase.
7. Never use rebase, force-push, or history rewrite unless the user explicitly requests it.

### 6) Build macOS Release Artifacts From Release Worktree

Preferred command shape:

```bash
npm run publish:mac
```

If the repo needs a separate local-only validation build first, it is acceptable to run:

```bash
npm run build:mac
```

Rules:

1. Build inside the release worktree, not the source worktree.
2. Prefer the repo's publish script when it already performs clean + build + verify + GitHub Release publication in one command.
3. If only a local validation build is used, call out that the release worktree `release/` directory may still contain older local artifacts until a publish/cleanup step runs.
4. Verify the release directory contains the mac updater metadata file (for example `latest-mac.yml`) before continuing.

### 7) Publish macOS Remote-Update Artifacts

After local mac release artifacts exist, publish the updater-compatible macOS files to GitHub Releases using the project's standard publish path.

Preferred command shape:

```bash
npm run publish:mac
```

Rules:

1. Remote publication is a required step for Mac remote-update support, not an optional postscript.
2. Stop immediately if GitHub publication fails. Do not report the release as complete if only the local DMG exists.
3. Confirm that the macOS updater metadata and downloadable artifact were included in the published release.
4. Report the tag/version that was published.

### 8) Copy Artifact Back To Canonical Repo Path

The user-facing DMG should always be copied back to the repo-root `release/` directory:

```bash
mkdir -p "<repo-root>/release"
ditto "<release-worktree>/release/<latest>.dmg" "<repo-root>/release/<latest>.dmg"
```

Rules:

1. Always report the repo-root path as the primary artifact path.
2. After a successful publish, prune stale versioned installer artifacts in `<repo-root>/release/` and keep only the current release's DMG plus any files the user explicitly asked to retain.
3. Do not make the user dig inside hidden `.worktrees/` paths to find the installer.
4. Treat the release worktree `release/` directory as disposable scratch output; the repo-root `release/` directory is the canonical handoff location.

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
2. Do not parse the mount path with `awk '{print $3}'`; it breaks on names like `/Volumes/Super CMS 1.1.1-arm64`.
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

### 12) Ask Before Switching A User Workspace Back To `main`

After the release is complete, ask one explicit question before switching any user-visible workspace:

`是否切回 main？`

Rules:

1. Default is no. Do not automatically switch the user's current workspace back to `main`.
2. This question must be asked only after release, publish, install, relaunch, and cleanup are otherwise complete.
3. The reason is session safety: another parallel session may still be using the current feature workspace.
4. If the user says no, leave the current workspace untouched and only report which clean path already has up-to-date `main`.
5. If the user says yes, switch only a safe clean workspace that is not carrying unrelated local edits.

### 13) Default Cleanup After Successful Release

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

### 14) Optional Extended Cleanup

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
7. local release directory keeps stacking old installers:
   - likely cause: repeated local builds without pruning canonical handoff artifacts
   - fix: after a successful publish, keep only the current version in `<repo-root>/release/` unless the user explicitly wants history retained
8. cleanup wants to delete the current feature branch:
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
11. whether switching a user workspace back to `main` was offered, accepted, or intentionally skipped
12. cleanup status for the temporary release branch/worktree, deleted merged local branches, and any retained active branches

## Safety Rules

1. Keep `git-governance` constraints active: explicit commit confirmation and bilingual commit messages.
2. Do not run destructive git commands (`reset --hard`, force-push, rebase, branch deletion, worktree deletion) without user approval.
3. On any failed critical step, stop chain execution and report exactly where it failed.
4. Prefer temporary release worktrees for isolation; prefer repo-root `release/` as the final artifact path.
