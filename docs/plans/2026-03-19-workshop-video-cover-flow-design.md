# Data Workshop Video Cover Flow Design

## Goal

Remove the current "auto first frame vs manual cover" mode switch from the Data Workshop video flow. Video previews should always generate with first-frame covers by default, while still allowing users to override individual items later or apply a batch cover folder in order.

## User Flow

1. The user imports one or more videos into the Data Workshop.
2. The user clicks `生成预览`.
3. The app batch-captures first-frame covers for the preview tasks and immediately renders the preview list.
4. After preview generation:
   - each video preview item shows its current cover;
   - the user may open the existing single-item cover editor to replace a cover;
   - the user may click a new `批量设置封面` action and pick a folder of images.
5. During publish, each task uses its own current `assignedImages[0]` as the cover. If the user never overrides a task, that task keeps the default first-frame cover.

## Core Rules

### Default preview generation

- Video preview generation always runs in batch mode.
- The app always captures the first frame for each video preview item.
- The generated first-frame image becomes the initial `assignedImages[0]` for that preview task.

### Single-item override

- Existing single-item cover editing remains available from the preview list/task card/detail modal.
- Replacing a cover updates the generated preview task immediately so later dispatch uses the latest cover.
- Clearing an override falls back to the generated first-frame cover rather than leaving the task without a cover.

### Batch cover folder override

- The app reads images from a user-picked folder.
- Files are filtered to supported image types only.
- Images are sorted by natural filename order.
- Mapping uses the current video preview task order, top to bottom.

Matching behavior:

- If preview count is greater than cover count, only the first N preview tasks are overridden; the rest keep first-frame covers.
- If counts are equal, every preview task receives one corresponding cover.
- If cover count is greater than preview count, only the first N covers are used; extras are ignored.

## Architecture

### Renderer

`DataBuilder.tsx` becomes the single source of truth for Data Workshop video cover management:

- preview generation always creates first-frame-backed video tasks;
- the top video control area becomes a cover management panel instead of a mode chooser;
- batch cover folder selection updates current preview tasks in memory;
- single-item edits continue to update current preview tasks in memory.

Pure helper modules will own deterministic transformations:

- sorting and filtering batch cover files from a folder;
- applying batch covers to preview tasks by order;
- keeping preview-task `assignedImages` synchronized after single-item or batch overrides.

### Main / Preload

The existing `openDirectory` dialog can be reused for folder picking. A small IPC helper will expose "list supported image files in a directory" so the renderer does not need Node file system access directly.

### Publish path

No publish-flow redesign is needed. The existing publish chain already reads each task's `images` field. Once Data Workshop keeps preview tasks synchronized, publish will naturally use:

- overridden covers when present;
- otherwise the generated first-frame cover.

## Error Handling

- If first-frame capture fails for a given video, preview generation still proceeds; that task shows no cover until the user replaces it.
- If the batch cover folder contains no supported images, show a user-facing message and keep existing covers unchanged.
- Non-image files in the chosen folder are ignored silently.
- If a selected folder contains fewer covers than preview tasks, unmatched preview tasks keep their current covers.

## Testing Strategy

Add pure tests for:

- natural filename sorting;
- batch cover mapping for fewer/equal/more images than preview tasks;
- preserving non-video tasks;
- syncing preview-task covers after overrides.

Verification should include targeted node tests and `npm run typecheck:web`.
