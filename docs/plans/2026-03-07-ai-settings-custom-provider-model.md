# AI Provider Profile Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade AI settings from single global fields to provider profiles with per-model API endpoints, while keeping the current runtime chain backward compatible.

**Architecture:** Add a persisted `aiProviderProfiles` structure in the main-process config layer, migrate legacy AI fields into one default provider profile, and keep legacy active-value fields synchronized with the selected provider/model. Update the Settings UI so users can save custom providers and provider-scoped models with endpoint paths, then make connection testing and AI Studio read the active resolved values.

**Tech Stack:** Electron, React, TypeScript, Zustand, Electron Store

---

### Task 1: Extend persisted config schema for provider profiles

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/store/useCmsStore.ts`
- Modify: `src/renderer/src/App.tsx`

**Steps:**
1. Add shared TypeScript shapes for provider profiles and model profiles in renderer-facing config types.
2. Add a new persisted config field for `aiProviderProfiles` and a compatibility field for `aiEndpointPath`.
3. Implement normalization helpers in `src/main/index.ts` to sanitize provider names, model names, endpoint paths, and profile arrays.
4. Implement one-way migration from legacy single AI config into a default provider profile when no profile list exists.
5. Keep `aiProvider`, `aiBaseUrl`, `aiApiKey`, `aiDefaultImageModel`, and `aiEndpointPath` synchronized with the active selected provider/model.
6. Expose the new fields through `get-config` and `save-config` IPC types.

### Task 2: Update Settings UI for provider-scoped editing

**Files:**
- Modify: `src/renderer/src/components/modules/Settings.tsx`

**Steps:**
1. Derive the currently selected provider profile from store config.
2. Replace the old provider custom input flow with “saved providers + custom provider” behavior.
3. Add local draft fields for new provider name, new model name, and model endpoint path.
4. Add `保存供应商` and `保存模型` actions with inline validation and clear status feedback.
5. Make the model dropdown show only models belonging to the selected provider.
6. Bind `Host / Base URL` and `API Key` editing to the active provider profile.
7. Bind `API 端点` editing to the active model profile.
8. Preserve the existing visual style and avoid introducing modal flows.

### Task 3: Resolve active AI config for runtime usage

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`
- Modify: `src/main/services/aiStudioService.ts`
- Modify: `src/main/index.ts`

**Steps:**
1. Ensure AI Studio reads the active selected provider/model values after migration.
2. Add `aiEndpointPath` to the resolved active config passed into runtime calls.
3. Make connection test logs and errors include provider/model/endpoint context.
4. Keep existing GRSAI-compatible behavior unchanged when no custom endpoint is configured.
5. Use the active model endpoint when the provider/model profile specifies one.

### Task 4: Verify end-to-end behavior

**Files:**
- Validate: `src/renderer/src/components/modules/Settings.tsx`
- Validate: `src/main/index.ts`
- Validate: `src/main/services/aiStudioService.ts`

**Steps:**
1. Run `npm run typecheck`.
2. Restart the dev process so `main` and `preload` changes are active.
3. Manually verify: save provider → save model → switch provider/model → endpoint updates → connection test uses active values.
4. Manually verify legacy config still loads into one migrated provider profile.
