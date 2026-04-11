# Local Gateway CMS Profile Design

**Problem**

The app currently auto-starts Local AI Gateway on launch and may attach its CDP proxy to the user's daily Chrome profile. On macOS this can trigger the remote debugging consent dialog on an actively used Chrome window, which breaks the intended isolation model we already established for CMS publishing.

**Goal**

Move Local Gateway onto the same dedicated CMS Chrome data directory model used by publishing, while reserving a distinct gateway-only profile so Local Gateway never touches the user's daily Chrome profiles.

**Decision**

Reuse `~/chrome-cms-data/` as the single managed Chrome data root for CMS automation, but add a gateway-dedicated profile record inside `cms-accounts.json`. Local Gateway will only launch and initialize against this managed profile. It will no longer enumerate or target system Chrome profiles from `~/Library/Application Support/Google/Chrome`.

## Scope

- Replace Local Gateway's profile source from system Chrome `Local State` to `~/chrome-cms-data/cms-accounts.json`.
- Introduce a managed gateway profile record, recommended fixed id `cms-gateway-profile`.
- Update Local Gateway settings UI to select and initialize CMS-managed profiles instead of daily Chrome profiles.
- Prevent startup auto-recovery from attempting to control system Chrome.
- Preserve existing CMS publisher profile management and existing Electron publish fallback.

## Non-Goals

- Do not migrate or copy cookies/data from the user's daily Chrome profile.
- Do not redesign Local Gateway's adapter/gateway service topology.
- Do not remove existing CMS publish profile functionality.

## Data Model

Extend `CmsChromeProfileRecord` with lightweight metadata:

- `purpose?: 'publisher' | 'gateway' | 'shared'`

Behavior:

- Existing records without `purpose` are treated as `publisher`.
- Local Gateway can filter/select CMS profiles with `purpose === 'gateway' || purpose === 'shared'`.
- A helper will ensure the presence of a default gateway profile record:
  - `id: "cms-gateway-profile"`
  - `profileDir: "cms-gateway-profile"`
  - `nickname: "本地网关专用"`
  - `purpose: "gateway"`

## Runtime Model

### Publisher

Unchanged in principle:

- Uses `~/chrome-cms-data/`
- Launches a bound account profile like `cms-profile-2`

### Local Gateway

Changed behavior:

- Uses `~/chrome-cms-data/`
- Uses gateway-selected CMS profile, defaulting to `cms-gateway-profile`
- Never reads or targets system Chrome profile directories
- If no gateway profile is initialized, startup should not attempt Chrome control

## Settings UX

Current Local Gateway settings expose a "Chrome Profile" concept that maps to daily Chrome. This becomes misleading once CMS-managed profiles exist.

Proposed UX changes:

- Rename selector semantics to CMS-managed gateway profile
- Populate options from `cms-accounts.json`
- Add actions:
  - "初始化网关专用 Profile"
  - "打开并登录网关 Profile"
  - optionally "验证网关 Profile"
- If old config still contains a legacy system profile directory name, surface it as a migration-needed state instead of using it

## Migration Strategy

1. Read old `localGateway.chromeProfileDirectory`.
2. If it matches a legacy system profile naming pattern and is not present in CMS-managed profiles:
   - do not use it for runtime control
   - mark Local Gateway state as requiring migration
3. Offer one-click initialization of `cms-gateway-profile`.
4. Store Local Gateway selection as CMS profile id/profileDir under the managed config.

## Risk Notes

- The Local AI Gateway bootstrap script may still assume system Chrome profile names. We need to pass it CMS-managed profile metadata and, if required, CMS data directory env vars.
- The settings UI needs to communicate clearly that gateway login is independent of daily Chrome login.
- Auto-start must degrade safely when the gateway profile is missing, rather than falling back to daily Chrome.

## Validation

- App launch no longer triggers the macOS remote debugging consent dialog on a daily Chrome window.
- Local Gateway can initialize against `cms-gateway-profile`.
- Publisher continues to run with bound CMS profiles.
- Daily Chrome may stay open without interference.
