---
name: git-governance
description: Enforce Git delivery governance for coding work in this repository. Use when starting new features or fixes, deciding whether to create a branch, choosing commit checkpoints, preparing commit messages, requesting pre-commit confirmation from the user, and keeping history clean and reversible.
---

# Git Governance

Apply this skill to every non-trivial code change.
Optimize for safe rollback, clear history, and explicit user control over commits.

## Core Rules

1. Keep `main` stable.
Create and use a feature branch for any change that affects behavior, spans multiple files, or touches production flow.
2. Gate every commit with user confirmation.
Do not commit automatically. First present a checkpoint summary and ask for explicit approval.
3. Keep commits reversible.
Commit only one coherent intent per commit (fix, refactor, test, docs), not mixed changes.
4. Verify before proposing commit.
Run relevant checks (at minimum typecheck/tests applicable to modified code) and report pass/fail.
5. Avoid hidden Git actions.
Do not push, rebase, or rewrite history unless explicitly requested.

## Branch Decision Policy

Use this decision order:

1. Start on `main` only when change is tiny and low-risk:
- single-file copy/text tweak;
- no logic change;
- no build/runtime impact.

2. Create a new branch when any of these is true:
- user asks for a new feature/fix;
- more than one file changes;
- workflow, scheduler, publish, DB, IPC, file IO, or auth changes;
- rollback risk is non-trivial.

3. Name branch with prefix `codex/`.
Use `codex/<scope>-<goal>` (example: `codex/publish-progress-timeout`).

## Concurrent Session Isolation

When multiple Codex sessions work on the same repository at the same time, follow these rules to prevent merge conflicts and lost work.

### Branch Creation for Concurrent Work

1. Always create your branch from `origin/main`, not local `main`.
Local `main` may be stale if another session already merged something.

```bash
git fetch origin
git checkout -b codex/<scope>-<goal> origin/main
```

2. Branch names must be unique and descriptive enough to avoid collisions.
Bad: `codex/fix`, `codex/update`.
Good: `codex/cdp-humanization`, `codex/flow-async-task`, `codex/video-note-smart-manual`.

3. Before starting work, check what other branches exist:

```bash
git branch -a | grep codex/
```

If another active branch touches the same files you plan to modify, stop and report the conflict risk to the user before proceeding.

### File Boundary Rule

4. Each concurrent task should declare its file scope at the start.
List the directories and files this task will modify in the first checkpoint summary.

5. If two concurrent tasks need to modify the same file, they must not run in parallel.
The user should either serialize them or explicitly accept the merge conflict risk.

6. Shared files that multiple tasks commonly touch (e.g., `package.json` version field, `CHANGELOG.md`, barrel exports like `index.ts`) should only be modified by the last task to merge, or by the release loop.

### Session Awareness

7. Do not assume you are the only session working on this repository.
Before any destructive operation (branch deletion, force push, worktree removal), check:

```bash
git worktree list
git branch -vv | grep codex/
```

8. Never delete a branch that is checked out in another worktree.

9. If you encounter unexpected commits on `main` that were not there when you started, do not panic. Fetch and rebase or merge as appropriate, then re-run validation.

## Commit Checkpoint Policy

Propose a commit checkpoint when any of these occurs:

1. A user-visible bug is fixed and verified.
2. A sub-feature reaches end-to-end usable state.
3. A risky area completes a coherent step (publish flow, scheduling, storage, migration).
4. A structural refactor finishes without behavior change.
5. A long session accumulates mixed edits that should be split.

## Commit Gate Protocol

At every checkpoint:

1. Summarize staged scope:
- files changed;
- user impact;
- risk notes;
- verification status.
2. Ask one explicit question:
- "是否现在提交这个节点？"
3. Commit only after user approval.
4. Use a focused conventional-style message:
- `fix: ...`
- `feat: ...`
- `refactor: ...`
- `chore: ...`
5. After commit, report:
- commit hash;
- changed files;
- next recommended checkpoint.

## Working Sequence

1. Inspect baseline:
`git status --short`, current branch, remote status, active worktrees, active `codex/` branches.
2. Decide branch using Branch Decision Policy.
3. If concurrent sessions are likely, apply Concurrent Session Isolation rules.
4. Implement change.
5. Run validations relevant to touched modules.
6. Evaluate checkpoint using Commit Checkpoint Policy.
7. Run Commit Gate Protocol.
8. Repeat until task complete.

## Safety Constraints

1. Do not amend, rebase, force-push, or reset unless user explicitly requests it.
2. Do not include generated binaries, build outputs, databases, or logs unless user explicitly requests.
3. Call out unexpected repository state immediately before proceeding.
4. When in doubt about whether another session is active, ask the user before proceeding with branch operations.

## Output Template At Checkpoint

Use this concise format:

1. `Checkpoint`: <what is complete>
2. `Files`: <key paths>
3. `Validation`: <pass/fail and command>
4. `Risk`: <none/low/medium + why>
5. `Concurrent`: <file overlap risk with other active branches, if any>
6. `Question`: `是否现在提交这个节点？`
