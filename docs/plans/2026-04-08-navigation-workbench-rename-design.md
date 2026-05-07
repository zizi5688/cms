# Navigation Workbench Rename Design

**Background**

The current desktop shell still exposes older navigation structure in the left sidebar:
- `AI素材工作台`
- `素材处理`
- `数据工坊`
- `媒体矩阵`
- other reporting modules

The product direction now wants the shell to guide users into the newer workbench-based flow:
- AI Studio becomes the primary landing module
- `AI素材工作台` is renamed to `素材工作台`
- `媒体矩阵` is renamed to `发布工作台`
- `素材处理` and `数据工坊` should no longer appear as direct sidebar entries

At the same time, the underlying `material` and `workshop` modules must remain available for internal jumps and existing code paths.

**Goal**

Simplify the navigation surface without removing legacy module capability:
- hide `素材处理` and `数据工坊` from the sidebar
- make AI Studio the default module on app launch
- rename visible navigation copy:
  - `AI素材工作台` -> `素材工作台`
  - `媒体矩阵` -> `发布工作台`

**Chosen Approach**

Apply a navigation-only adjustment in the renderer shell.

- Keep module ids unchanged:
  - `aiStudio`
  - `material`
  - `workshop`
  - `autopublish`
- Change only:
  - sidebar menu composition
  - visible sidebar labels
  - initial `activeModule` default in shared store

This preserves all internal routing and state behavior while aligning the app's visible IA with the new workbench framing.

**Why This Approach**

This is the lowest-risk path because it does not change:
- module ownership
- internal state keys
- deep link behavior
- store APIs
- existing cross-module jumps from AI Studio or other modules

It only changes what users see first and what they can click from the main sidebar.

**User Experience Changes**

After this change:
- app launch opens AI Studio by default
- the left sidebar no longer shows:
  - `素材处理`
  - `数据工坊`
- the left sidebar shows:
  - `素材工作台`
  - `发布工作台`
  - existing analytics/report modules
  - settings

Internal actions that navigate to `material` or `workshop` remain valid. Users simply no longer enter those modules from the sidebar.

**Information Architecture Rules**

Visible navigation:
- `aiStudio` label becomes `素材工作台`
- `autopublish` label becomes `发布工作台`
- `raceboard`, `heatboard`, and `settings` remain visible

Hidden-but-retained modules:
- `material`
- `workshop`
- optionally `upload` if it is already hidden in the active sidebar component

Default active module:
- switch from `material` to `aiStudio`

**Implementation Scope**

Files likely involved:
- `src/renderer/src/components/layout/Sidebar.tsx`
- `src/renderer/src/store/useCmsStore.ts`

Possibly verify but not necessarily modify:
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/layout/MainLayout.tsx`
- any duplicate or legacy sidebar component still referenced by older shells

**Out Of Scope**

Not included in this change:
- deleting `material` or `workshop` modules
- changing internal module ids
- migrating old feature flows away from `material` / `workshop`
- rewriting logs, database terms, or historical naming everywhere
- changing non-sidebar page titles unless needed for obvious shell consistency

**Risk Notes**

Main risk is low and centered on hidden assumptions:
- some startup flow may still assume `material` is the default visible module
- a legacy sidebar component may still exist and cause inconsistent labels if rendered elsewhere

This should be verified by checking:
- the active sidebar component actually used by `MainLayout`
- launch behavior after store default changes
- any code that conditionally runs based on initial `activeModule`

**Validation Strategy**

Minimum validation:
- typecheck renderer
- smoke launch app
- confirm initial module is AI Studio
- confirm sidebar no longer shows `素材处理` / `数据工坊`
- confirm sidebar now shows `素材工作台` / `发布工作台`
- confirm internal navigation to hidden modules still compiles and is not broken by the store type usage
