import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'crypto'
import { SqliteService } from './sqliteService'

export type XHSAccountStatus = 'logged_in' | 'expired' | 'offline'

export interface XHSAccount {
  id: string
  name: string
  partitionKey: string
  status: XHSAccountStatus
}

/** Backward-compatible alias used by publisher.ts */
export type AccountRecord = XHSAccount & { lastLoginTime?: number | null }

function normalizeAccountName(name: string): string {
  const trimmed = name.trim()
  return trimmed || 'XHS Account'
}

function buildPartitionKey(id: string): string {
  return `persist:xhs_${id}`
}

function ensureUniqueName(accounts: XHSAccount[], desiredName: string): string {
  const base = normalizeAccountName(desiredName)
  const existing = new Set(accounts.map((a) => a.name))
  if (!existing.has(base)) return base

  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})`
    if (!existing.has(candidate)) return candidate
  }

  return `${base} (${Date.now()})`
}

export class AccountManager {
  private sqlite: SqliteService
  private loginWindowsByAccountId = new Map<string, BrowserWindow>()

  constructor(sqlite?: SqliteService) {
    this.sqlite = sqlite ?? SqliteService.getInstance()
  }

  listAccounts(): XHSAccount[] {
    const rows = this.sqlite.connection
      .prepare(`SELECT id, name, partitionKey, status FROM accounts ORDER BY rowid ASC`)
      .all() as Array<Record<string, unknown>>

    return rows
      .map((row) => {
        const id = typeof row.id === 'string' ? row.id : ''
        const name = typeof row.name === 'string' ? row.name : ''
        const partitionKey = typeof row.partitionKey === 'string' ? row.partitionKey : ''
        const statusRaw = typeof row.status === 'string' ? row.status : 'offline'
        const status: XHSAccountStatus =
          statusRaw === 'logged_in' || statusRaw === 'expired' || statusRaw === 'offline' ? statusRaw : 'offline'
        if (!id || !name || !partitionKey) return null
        return { id, name, partitionKey, status }
      })
      .filter((v): v is XHSAccount => Boolean(v))
  }

  getAccount(accountId: string): XHSAccount | null {
    const id = String(accountId ?? '').trim()
    if (!id) return null

    const row = this.sqlite.connection
      .prepare(`SELECT id, name, partitionKey, status FROM accounts WHERE id = ? LIMIT 1`)
      .get(id) as Record<string, unknown> | undefined

    if (!row) return null
    const accountIdValue = typeof row.id === 'string' ? row.id : ''
    const name = typeof row.name === 'string' ? row.name : ''
    const partitionKey = typeof row.partitionKey === 'string' ? row.partitionKey : ''
    const statusRaw = typeof row.status === 'string' ? row.status : 'offline'
    const status: XHSAccountStatus =
      statusRaw === 'logged_in' || statusRaw === 'expired' || statusRaw === 'offline' ? statusRaw : 'offline'
    if (!accountIdValue || !name || !partitionKey) return null
    return { id: accountIdValue, name, partitionKey, status }
  }

  createAccount(name: string): XHSAccount {
    const accounts = this.listAccounts()
    const id = randomUUID()
    const account: XHSAccount = {
      id,
      name: ensureUniqueName(accounts, name),
      partitionKey: buildPartitionKey(id),
      status: 'offline'
    }

    this.sqlite.connection
      .prepare(`INSERT INTO accounts (id, name, partitionKey, status, lastLoginTime) VALUES (?, ?, ?, ?, NULL)`)
      .run(account.id, account.name, account.partitionKey, account.status)

    return account
  }

  updateAccount(accountId: string, patch: Partial<Pick<XHSAccount, 'name' | 'status'>>): XHSAccount {
    const id = String(accountId ?? '').trim()
    if (!id) throw new Error(`[XHS] Account not found: ${accountId}`)

    const current = this.getAccount(id)
    if (!current) throw new Error(`[XHS] Account not found: ${accountId}`)

    const accounts = this.listAccounts()
    const nextName =
      typeof patch.name === 'string' && patch.name.trim()
        ? ensureUniqueName(accounts.filter((a) => a.id !== id), patch.name)
        : current.name

    const nextStatus = patch.status ?? current.status
    const next: XHSAccount = { ...current, name: nextName, status: nextStatus }

    this.sqlite.connection.prepare(`UPDATE accounts SET name = ?, status = ? WHERE id = ?`).run(next.name, next.status, id)
    return next
  }

  renameAccount(accountId: string, name: string): XHSAccount {
    const normalizedAccountId = String(accountId ?? '').trim()
    if (!normalizedAccountId) throw new Error('[XHS] accountId is required.')
    const nextName = String(name ?? '').trim()
    if (!nextName) throw new Error('[XHS] name is required.')
    return this.updateAccount(normalizedAccountId, { name: nextName })
  }

  async deleteAccount(accountId: string): Promise<{ success: boolean }> {
    const normalizedAccountId = String(accountId ?? '').trim()
    if (!normalizedAccountId) throw new Error('[XHS] accountId is required.')

    const account = this.getAccount(normalizedAccountId)
    if (!account) return { success: false }

    // Close cached login window if any
    const cached = this.loginWindowsByAccountId.get(normalizedAccountId)
    if (cached) {
      this.loginWindowsByAccountId.delete(normalizedAccountId)
      if (!cached.isDestroyed()) cached.close()
    }

    // Transactional delete: accounts + tasks + products
    const db = this.sqlite.connection
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM products WHERE accountId = ?`).run(normalizedAccountId)
      db.prepare(`DELETE FROM tasks WHERE accountId = ?`).run(normalizedAccountId)
      db.prepare(`DELETE FROM accounts WHERE id = ?`).run(normalizedAccountId)
    })
    tx()

    // Clear Electron session data
    const accountSession = session.fromPartition(account.partitionKey)
    try {
      await accountSession.clearStorageData()
      await accountSession.clearCache()
    } catch {
      void 0
    }

    return { success: true }
  }

  async checkLoginStatus(accountId: string): Promise<boolean> {
    const normalizedAccountId = String(accountId ?? '').trim()
    if (!normalizedAccountId) throw new Error('[XHS] accountId is required.')
    const account = this.getAccount(normalizedAccountId)
    if (!account) throw new Error(`[XHS] Account not found: ${normalizedAccountId}`)

    const accountSession = session.fromPartition(account.partitionKey)

    const cookieNameCandidates = new Set(['web_session', 'sid', 'a1'])
    const domainsToCheck = ['.xiaohongshu.com', 'creator.xiaohongshu.com']
    const cookies = (
      await Promise.all(domainsToCheck.map((domain) => accountSession.cookies.get({ domain })))
    ).flat()

    const found = cookies.some(
      (cookie) => cookieNameCandidates.has(cookie.name) && typeof cookie.value === 'string' && cookie.value.trim().length > 0
    )

    if (!found) return false

    // Update lastLoginTime in SQLite
    this.sqlite.connection
      .prepare(`UPDATE accounts SET lastLoginTime = ? WHERE id = ?`)
      .run(Date.now(), normalizedAccountId)
    return true
  }

  async openLoginWindow(options: { accountId: string; url?: string }): Promise<{ windowId: number }> {
    const accountId = String(options.accountId ?? '').trim()
    if (!accountId) throw new Error('[XHS] accountId is required.')
    const account = this.getAccount(accountId)
    if (!account) throw new Error(`[XHS] Account not found: ${accountId}`)

    const cached = this.loginWindowsByAccountId.get(accountId)
    if (cached && !cached.isDestroyed()) {
      cached.show()
      cached.focus()
      return { windowId: cached.id }
    }

    const window = new BrowserWindow({
      width: 1200,
      height: 900,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition: account.partitionKey,
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    window.on('closed', () => {
      const stillCached = this.loginWindowsByAccountId.get(accountId)
      if (stillCached === window) this.loginWindowsByAccountId.delete(accountId)
      void this.checkLoginStatus(accountId).catch(() => {})
    })

    this.loginWindowsByAccountId.set(accountId, window)

    const url = typeof options.url === 'string' && options.url.trim() ? options.url.trim() : 'https://creator.xiaohongshu.com/'
    await window.loadURL(url)
    window.show()
    window.focus()

    return { windowId: window.id }
  }

  removeAccount(accountId: string): XHSAccount | null {
    const id = String(accountId ?? '').trim()
    if (!id) return null
    const removed = this.getAccount(id)
    if (!removed) return null

    const db = this.sqlite.connection
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM products WHERE accountId = ?`).run(id)
      db.prepare(`DELETE FROM tasks WHERE accountId = ?`).run(id)
      db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id)
    })
    tx()

    return removed
  }

  async clearAccountSession(accountId: string): Promise<void> {
    const account = this.getAccount(accountId)
    if (!account) throw new Error(`[XHS] Account not found: ${accountId}`)
    const s = session.fromPartition(account.partitionKey)
    await s.clearStorageData()
  }

  getPartitionKey(accountId: string): string {
    const account = this.getAccount(accountId)
    if (!account) throw new Error(`[XHS] Account not found: ${accountId}`)
    return account.partitionKey
  }
}
