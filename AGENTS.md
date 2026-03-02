# AGENTS.md instructions for /Users/z/TraeBase/Project/CMS-2.0

## Skills
A skill is a set of local instructions stored in a `SKILL.md` file.

### Available skills
- git-governance: Git delivery governance for this repo. Use when starting a feature/fix, deciding whether to create a branch, deciding commit checkpoints, or asking for pre-commit confirmation. (file: /Users/z/TraeBase/Project/CMS-2.0/skills/git-governance/SKILL.md)
- xhs-dip: Xiaohongshu data interaction protocol. Use for XHS network automation, anti-block, extraction, and compliance checks. (file: /Users/z/TraeBase/Project/CMS-2.0/skills/xhs-dip/SKILL.md)
- release-windows-github: Publish new Windows versions to GitHub Releases and give beginner-friendly update steps for local maintainer + target Windows machine. Use for “发新版”, “发布新版”, “更新 Windows 安装包”, “远程更新已安装版本”. (file: /Users/z/TraeBase/Project/CMS-2.0/skills/release-windows-github/SKILL.md)
- phase-release-loop: Execute stage closeout for Mac desktop delivery chain: commit/push, merge main, build DMG, install over existing app, relaunch. Use for “阶段收尾”, “提交并推送+合并main+打包dmg+覆盖安装+重启”, or similar one-shot release requests. (file: /Users/z/TraeBase/Project/CMS-2.0/skills/phase-release-loop/SKILL.md)
- skill-creator: Guide for creating/updating skills. Use when user asks to create or revise a skill. (file: /Users/z/.codex/skills/.system/skill-creator/SKILL.md)
- skill-installer: Install skills into `$CODEX_HOME/skills`. Use when user asks to list/install skills from curated sources or GitHub paths. (file: /Users/z/.codex/skills/.system/skill-installer/SKILL.md)

## How to use skills
- Discovery: Use the list above as the source of truth for this repository.
- Trigger rules: If user names a skill with `$skill-name` or the task clearly matches a skill description, use that skill in this turn.
- Trigger rules: If user asks to release/publish/update Windows desktop versions through GitHub (e.g., “发新版”, “发布新版”, “Windows 更新”), use `release-windows-github`.
- Trigger rules: If user asks for stage closeout delivery on Mac (commit/push/merge main/build dmg/install/restart chain), use `phase-release-loop`.
- Multiple skills: Use the minimal set that covers the task, and apply them in explicit order.
- Missing/blocked: If a skill path cannot be read, report briefly and continue with best fallback.

## Collaboration defaults
- For non-trivial code changes, apply `git-governance`.
- At each commit checkpoint, summarize changes and ask explicit user confirmation before committing.
- For new features/fixes, default to creating a `codex/<scope>-<goal>` branch unless the change is tiny and low-risk.
