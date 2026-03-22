# Video Cover Mode Publish Design

## Goal

Split video cover behavior into explicit `auto` and `manual` modes so Data Workshop can keep generating local first-frame previews, while Xiaohongshu publish skips the manual cover-upload flow whenever the task is still using the default first frame.

## Root Cause

The current system overloads video task `images[0]` for two different purposes:

- local preview/list/card cover;
- publish-time manual cover source.

Because Data Workshop always generates a first-frame image and stores it into `assignedImages[0]`, the publish chain later treats that image as a manual cover and executes `setVideoCover()`. This makes default first-frame tasks behave like manual-cover tasks and is the main reason different videos can accidentally reuse the same uploaded cover path.

## Approved Rules

### Cover mode

Add a task-level field:

- `videoCoverMode = 'auto' | 'manual'`

Rules:

- `auto`: local first-frame image may still exist for preview/card/list display, but Xiaohongshu publish must skip `setVideoCover()` and rely on platform default first frame.
- `manual`: keep the current publish behavior and upload/set the chosen cover image.
- old tasks with no stored value default to `manual` for compatibility.

### What switches a task to manual

Any explicit user cover action switches the task to `manual`:

- ImageLab `截取当前帧为封面`;
- ImageLab `上传封面`;
- Data Workshop single-item `截取当前帧`;
- Data Workshop single-item `手动上传图片`;
- Data Workshop batch cover-folder override;
- any task-detail cover replacement entry.

### What switches a task back to auto

- `恢复默认首帧` sets `videoCoverMode` back to `auto` and restores the publish-time meaning to “skip manual cover upload”.

## Architecture

### Renderer

Renderer task state keeps both pieces of information:

- `assignedImages[0]`: current local preview cover image;
- `videoCoverMode`: whether publish should treat the cover as manual.

This lets the UI keep showing first-frame previews without forcing the publish chain to upload them as covers.

### Persistence and queue

Persist `videoCoverMode` on tasks and carry it through:

- create-batch payload normalization;
- `taskManager` creation and reads;
- SQLite schema + migrations;
- queue fetches;
- publisher normalization.

Compatibility rule: missing DB/payload value resolves to `manual`.

### XHS publish

Video publish keeps the existing step structure:

1. prepare;
2. upload video;
3. cover;
4. content/products;
5. publish.

At cover step:

- `manual`: existing `setVideoCover()` flow unchanged;
- `auto`: log a clear skip message such as `使用默认首帧，跳过手动设置封面` and mark the cover step complete without opening the cover modal.

## Error Handling

- `auto` mode removes native file-dialog and cover-modal failures from default-first-frame tasks entirely.
- `manual` mode keeps existing failure behavior for now.
- If preview first-frame generation fails locally, the task can still be published in `auto` mode because publish no longer depends on that preview image.

## Testing Strategy

Add focused tests for:

- task payload normalization of `videoCoverMode`;
- renderer cover-sync helpers updating mode on override vs restore-default;
- batch cover helpers forcing manual mode;
- publish session parsing of the new skip message;
- publisher / automation normalization defaulting missing mode to `manual` and skipping cover upload only for `auto`.
