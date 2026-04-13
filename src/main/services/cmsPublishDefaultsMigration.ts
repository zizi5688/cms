import {
  normalizeCmsElectronPublishAction,
  type CmsElectronPublishAction,
  type CmsPublishMode
} from '../../shared/cmsChromeProfileTypes.ts'

const CMS_PUBLISH_DEFAULTS_MIGRATION_VERSION = '2026-04-13-electron-default'

export type CmsPublishDefaultsStore = {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export type CmsPublishDefaultsMigrationResult = {
  didMigrate: boolean
  publishMode: CmsPublishMode
  electronPublishAction: CmsElectronPublishAction
}

function normalizeStoredPublishMode(value: unknown): CmsPublishMode {
  return value === 'cdp' ? 'cdp' : 'electron'
}

export function applyCmsPublishDefaultsMigration(
  store: CmsPublishDefaultsStore
): CmsPublishDefaultsMigrationResult {
  const storedMigrationVersion = String(store.get('cmsPublishDefaultsMigrationVersion') ?? '').trim()
  const electronPublishAction = normalizeCmsElectronPublishAction(store.get('electronPublishAction'))

  if (storedMigrationVersion !== CMS_PUBLISH_DEFAULTS_MIGRATION_VERSION) {
    store.set('publishMode', 'electron')
    store.set('electronPublishAction', electronPublishAction)
    store.set('cmsPublishDefaultsMigrationVersion', CMS_PUBLISH_DEFAULTS_MIGRATION_VERSION)
    return {
      didMigrate: true,
      publishMode: 'electron',
      electronPublishAction
    }
  }

  const publishMode = normalizeStoredPublishMode(store.get('publishMode'))
  store.set('publishMode', publishMode)
  store.set('electronPublishAction', electronPublishAction)

  return {
    didMigrate: false,
    publishMode,
    electronPublishAction
  }
}
