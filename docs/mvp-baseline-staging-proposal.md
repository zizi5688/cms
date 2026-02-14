# MVP Baseline Staging Proposal (Draft 1)

## Purpose

Provide a controlled first-pass staging set for `codex/mvp-baseline`, avoiding accidental inclusion of generated or ambiguous assets.

## Stage Group A (governance + project skeleton)

```bash
git add \
  .gitignore \
  .githooks \
  .gitmessage.txt \
  AGENTS.md \
  skills \
  docs/git-governance.md \
  docs/mvp-baseline-plan.md \
  docs/mvp-baseline-staging-proposal.md \
  .github/PULL_REQUEST_TEMPLATE/governance-skeleton.md \
  scripts/git-bootstrap.sh \
  scripts/git-new-branch.sh
```

## Stage Group B (core app source)

```bash
git add \
  src \
  package.json \
  package-lock.json \
  electron.vite.config.ts \
  electron-builder.json \
  tailwind.config.js \
  tsconfig.json \
  tsconfig.node.json \
  tsconfig.web.json
```

## Stage Group C (required runtime helpers)

```bash
git add \
  python \
  scripts \
  build/README.md \
  cms_engine.spec
```

## Explicitly Hold (do not stage now)

1. `node_modules/`
2. `dist/`
3. `out/`
4. `release/`
5. `outputs/`
6. `AI_Tools/` (pending ownership decision)

## Verification Before Commit

```bash
git status --short
npm run typecheck
```

If status contains unintended files, run:

```bash
git restore --staged <path>
```
