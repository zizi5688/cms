# Mac Auto Update Design

**Problem**

The project already supports Windows remote updates through GitHub Releases, but macOS deployments still depend on manually distributing DMG installers. The goal is to let internal Mac clients receive update notifications, download updates in the background, and either install on quit or restart immediately from inside the app.

**Goals**

- Reuse the existing GitHub Releases repository `zizi5688/cms` for both Windows and macOS update delivery.
- Enable automatic update checks for packaged macOS builds.
- Download macOS updates in the background.
- Let users choose `立即重启更新` or `稍后，退出时自动安装`.
- Keep development mode disabled for auto update.
- Extend the local `$phase-release-loop` release closeout workflow so a normal Mac stage closeout also publishes the remote-update artifacts.

**Non-Goals**

- Apple notarization in the first phase.
- Forced updates.
- Gray rollout channels.
- A separate release repository or custom update service.
- Supporting auto update for development builds.

## Recommended Approach

Use the existing `electron-updater` integration as the single updater implementation for packaged Windows and packaged macOS builds, backed by the same GitHub Releases feed. Keep the current behavior model of `autoDownload = true` and `autoInstallOnAppQuit = true`, then expose a clearer post-download prompt on macOS so users can either restart immediately or defer installation until app exit.

This keeps the runtime behavior aligned across platforms while minimizing new moving parts. The real work is not inventing a new updater, it is making macOS packaging and release outputs compatible with `electron-updater` and then teaching the release skill to publish those outputs as part of normal stage closeout.

## Architecture

### 1. Runtime Update Service

The existing update service in [autoUpdate.ts](/Users/z/TraeBase/Project/CMS-2.0/src/main/services/autoUpdate.ts) already manages state, background download, install prompting, and renderer IPC. It is currently hard-disabled outside Windows. We will generalize it to:

- enable for packaged `win32` and packaged `darwin`
- keep startup auto-check
- keep manual check from Settings
- keep `autoDownload = true`
- keep `autoInstallOnAppQuit = true`
- show a cross-platform downloaded state and install action

The renderer continues to treat update state as a small state machine. No new updater IPC surface is needed beyond existing status/check/install channels.

### 2. Packaging Outputs

The current Mac build only targets `dmg` in [electron-builder.json](/Users/z/TraeBase/Project/CMS-2.0/electron-builder.json). For `electron-updater` on macOS, the release needs macOS updater metadata and a compatible downloadable artifact in addition to the DMG the maintainer uses locally.

The first phase should therefore:

- keep DMG output for local install and manual verification
- add the macOS updater-compatible artifact set required by `electron-builder`
- continue publishing to the existing GitHub Releases target

Because the target fleet is internal and controlled, we optimize for reliable internal distribution first. If signing or Gatekeeper policy becomes the blocker, we can add stricter packaging hardening later without redesigning the update flow.

### 3. Release Pipeline

Windows already has explicit release scripts for GitHub publication. macOS needs the same shape:

- build packaged macOS artifacts
- verify updater metadata exists
- publish artifacts to the GitHub Release for the app version

The important product outcome is this: once a maintainer completes a macOS release, other internal Mac clients should see the update from GitHub Releases without any manual DMG transfer.

### 4. Phase Closeout Skill

The local [$phase-release-loop](/Users/z/.codex/skills/phase-release-loop/SKILL.md) currently ends at:

- merge to `main`
- build DMG
- copy DMG back to repo root
- install over `/Applications/Super CMS.app`
- relaunch

That is no longer enough once macOS remote update exists. The skill must be updated so a standard Mac closeout also publishes the macOS remote-update artifacts before local installation is reported complete.

The updated loop should conceptually become:

1. validate, commit, and push source branch
2. merge to `main` through isolated release worktree
3. build macOS release artifacts
4. publish macOS updater artifacts to GitHub Releases
5. copy canonical DMG back to repo-root `release/`
6. install locally to `/Applications/Super CMS.app`
7. relaunch and report both local install success and remote update publication success

## User Experience

### Settings Page

The Settings update card should become cross-platform instead of Windows-only.

Expected user-facing states:

- 自动更新已就绪
- 正在检查更新...
- 发现新版本，正在后台下载...
- 正在下载更新 xx.x%
- 更新已下载完成，可立即重启更新
- 若稍后处理，将在退出时自动安装
- 当前已是最新版本
- 检查更新失败：...

### Update Prompt

When the update finishes downloading on macOS, show:

- `立即重启更新`
- `稍后`

If the user chooses `稍后`, the app should leave the downloaded update in place and rely on quit-time installation.

## File Impact

Expected first-pass implementation areas:

- [autoUpdate.ts](/Users/z/TraeBase/Project/CMS-2.0/src/main/services/autoUpdate.ts)
- [Settings.tsx](/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/modules/Settings.tsx)
- [electron-builder.json](/Users/z/TraeBase/Project/CMS-2.0/electron-builder.json)
- new mac release script(s) under [/Users/z/TraeBase/Project/CMS-2.0/scripts](/Users/z/TraeBase/Project/CMS-2.0/scripts)
- local skill doc [$phase-release-loop](/Users/z/.codex/skills/phase-release-loop/SKILL.md)

## Risks

### Packaging Compatibility

The biggest real risk is not the JavaScript updater logic. It is whether the macOS packaging outputs are sufficient for `electron-updater` to detect and apply updates. This must be verified by inspecting actual release artifacts after a packaged build.

### Internal Distribution Assumptions

The design assumes internal controlled Macs can run the packaged app and apply updates without full notarization in phase one. If that assumption fails on target devices, the packaging hardening work will need to move earlier in scope.

### Release Loop Expansion

Updating `$phase-release-loop` changes it from a purely local delivery loop into a local-plus-remote delivery loop. It must fail loudly if GitHub publication fails, otherwise the maintainer may think “release finished” while remote clients still have nothing to update from.

## Testing Strategy

- unit coverage for runtime update enablement conditions
- manual packaged-build verification on macOS
- GitHub Release artifact verification for mac updater files
- local app install verification from DMG
- end-to-end remote update verification on a second internal Mac client

## Rollout Plan

Phase 1:

- enable packaged macOS auto update
- publish macOS updater artifacts to existing GitHub Releases
- update Settings UI and prompts
- update `$phase-release-loop`

Phase 2, only if needed:

- signing hardening
- notarization
- release-channel separation
- richer update observability
