# MVP Baseline Plan

## Goal

Establish a trustworthy MVP baseline from the current working state, then switch to strict branch-based delivery.

This plan does **not** attempt to reconstruct historical commits. It snapshots the current usable product state and uses that as version-management start point.

## Start Point

- Baseline working branch: `codex/mvp-baseline`
- Governance branch already prepared: `codex/p0-git-governance-rollout`
- Remote repository: `origin` -> `https://github.com/zizi5688/cms.git`

## Baseline Scope Strategy

### Include in baseline commit

1. Runtime source code and app entrypoints:
   - `src/**`
   - `package.json`
   - `package-lock.json`
   - `electron.vite.config.ts`
   - `electron-builder.json`
2. Product docs required to understand current MVP:
   - `README.md`
   - `docs/TECHNICAL_ARCH.md`
   - `docs/PRODUCT_PRD.md`
   - `docs/User_Manual.md`
3. Build/runtime scripts and required Python helpers:
   - `scripts/**` (excluding temporary files)
   - `python/**`
4. Governance files:
   - `.githooks/**`
   - `.gitmessage.txt`
   - `.gitignore`
   - `AGENTS.md`
   - `skills/**`

### Exclude from baseline commit

1. Local/derived artifacts:
   - `node_modules/`
   - `dist/`
   - `out/`
   - `release/`
   - `outputs/`
2. Local DB/log/cache/temp files:
   - `*.sqlite*`, logs, temporary folders
3. Unclear ownership/legacy dump folders until confirmed:
   - `AI_Tools/` (review before include)

## Execution Phases

## Phase 1: Scope Freeze

1. Freeze baseline scope list (include/exclude).
2. Confirm any ambiguous folder before commit (especially large non-source folders).

Exit criteria:

- include/exclude list approved.

## Phase 2: Repository Hygiene

1. Ensure `.gitignore` covers all generated artifacts and DB/log files.
2. Validate governance hooks and branch policy are enabled.
3. Ensure baseline branch is rebased/updated from governance branch if needed.

Exit criteria:

- repo state is clean enough for controlled staging.

## Phase 3: Baseline Snapshot Commit

1. Stage only approved baseline scope.
2. Run minimum validation:
   - `npm run typecheck`
   - one MVP smoke path check (manual)
3. Create baseline commit:
   - `chore: snapshot MVP baseline`

Exit criteria:

- baseline commit exists and is reproducible.

## Phase 4: Baseline PR + Tag

1. Open PR from `codex/mvp-baseline` to `main`.
2. Use governance PR template.
3. After merge, tag baseline:
   - `v0.1.0-mvp-baseline`

Exit criteria:

- baseline merged and tagged.

## Ongoing Delivery Rule (Post-Baseline)

1. Never develop directly on `main`.
2. Every feature/fix starts from `codex/<scope>-<goal>`.
3. Every checkpoint needs explicit commit approval.
4. Merge to `main` only via PR.

## Immediate Next Actions (This Branch)

1. Confirm whether `AI_Tools/` should be part of product source baseline.
2. Produce first staged file set proposal for baseline commit.
3. Run `npm run typecheck` once staged scope is prepared.
