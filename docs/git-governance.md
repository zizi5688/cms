# Git Governance (P0)

This repository follows a strict rule: do not ship feature work directly on `main`.

## One-Time Setup (per clone)

Run:

```bash
scripts/git-bootstrap.sh
```

This sets:
- `core.hooksPath=.githooks`
- `commit.template=.gitmessage.txt`
- `fetch.prune=true`

## Branch Rule

1. For new features/fixes, create a branch using prefix `codex/`.
2. Branch naming format: `codex/<scope>-<goal>`.
3. Example: `codex/preview-thumb-pipeline`.

Quick command:

```bash
scripts/git-new-branch.sh preview-thumb-pipeline
```

## Commit Rule

1. Reach a meaningful checkpoint (bug fixed, sub-feature complete, risky step complete).
2. Run verification (typecheck/tests relevant to touched area).
3. Summarize checkpoint and ask for explicit approval before committing.
4. Commit only after approval.

Checkpoint template:

1. `Checkpoint`: what is complete
2. `Files`: key paths
3. `Validation`: pass/fail + command
4. `Risk`: none/low/medium
5. `Question`: `是否现在提交这个节点？`

## Main Protection

Local hooks block direct commit/push on `main/master`.

- Hooks:
  - `.githooks/pre-commit`
  - `.githooks/pre-push`
- Emergency bypass:

```bash
ALLOW_MAIN_COMMIT=1 git commit -m "..."
ALLOW_MAIN_PUSH=1 git push origin main
```

## Minimal Daily Workflow

```bash
# 1) Create a branch
scripts/git-new-branch.sh preview-thumb-pipeline

# 2) Work and verify
npm run typecheck

# 3) Ask checkpoint confirmation, then commit
git add <files>
git commit

# 4) Push branch
git push -u origin $(git branch --show-current)
```
