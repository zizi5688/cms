---
name: phase-release-loop
description: Execute the end-of-phase desktop delivery loop in this repository. Use when the user asks for stage closeout or says “提交并推送”, “合并到 main”, “打包 DMG”, “覆盖安装旧版”, “重启应用”, or similar release-chain requests.
---

# Phase Release Loop

## Goal

Run a deterministic Mac release loop with minimal user typing:

1. verify current workspace and validation status
2. commit and push feature branch
3. merge to `main` and push
4. build latest mac DMG
5. install over `/Applications/Super CMS.app`
6. relaunch app and report result

## Required Inputs

Before execution, confirm these values (infer reasonable defaults when omitted):

1. commit scope paths
2. bilingual commit message in format `type: 中文 / English`
3. source branch (default: current branch)
4. target branch (default: `main`)
5. whether to continue on merge conflict (default: stop)

## Workflow

### 1) Baseline Inspection

Run:

```bash
git status --short
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name @{u}
```

Rules:

1. If current branch is `main`, stop and ask whether to create/switch branch first.
2. If workspace has unrelated dirty files, explicitly ask whether to include them; do not auto-stage all.

### 2) Validation Gate

Run repository checks before commit:

```bash
npm run typecheck
```

When relevant, add targeted lint/tests for touched modules.

If validation fails, stop and report first failing command/output summary.

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

### 4) Merge To Main

After push success, run:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git merge --no-ff <source-branch>
git push origin main
```

Rules:

1. On merge conflict: stop immediately, report conflicted files, do not auto-resolve.
2. Do not rebase or force-push unless user explicitly requests.

### 5) Build DMG

Use project standard script:

```bash
npm run build:mac
```

Then locate newest DMG:

```bash
ls -t release/*.dmg | head -n 1
```

If no DMG exists, stop and report build artifact mismatch.

### 6) Install And Replace App

Install by mounting DMG and copying app bundle:

```bash
DMG_PATH="$(ls -t release/*.dmg | head -n 1)"
VOLUME_PATH="$(hdiutil attach \"$DMG_PATH\" -nobrowse | awk '/\\/Volumes\\// {print $3; exit}')"
ditto \"$VOLUME_PATH/Super CMS.app\" \"/Applications/Super CMS.app\"
hdiutil detach \"$VOLUME_PATH\"
```

Rules:

1. If app bundle name differs, detect `*.app` under mounted volume and use that path.
2. Never delete app manually before copy unless user explicitly asks.

### 7) Relaunch App

```bash
pkill -f "/Applications/Super CMS.app/Contents/MacOS/Super CMS" || true
open "/Applications/Super CMS.app"
pgrep -fal "/Applications/Super CMS.app/Contents/MacOS/Super CMS"
```

If process check fails, report and provide manual open fallback.

## Final Report Template

Return a concise release report with:

1. commit hash and message
2. pushed source branch and merge target
3. merge result
4. DMG full path and build timestamp
5. install result (`/Applications/Super CMS.app`)
6. relaunch process status (PID or failure reason)
7. next action (if any)

## Safety Rules

1. Keep `git-governance` constraints active: explicit commit confirmation and bilingual commit message.
2. Do not run destructive git commands (`reset --hard`, force-push, rebase) without explicit user request.
3. On any failed critical step, stop chain execution and report exactly where it failed.
