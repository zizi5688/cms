import { SqliteService } from './sqliteService'

export type XhsProductRecord = {
  id: string
  name: string
  price: string
  cover: string
  productUrl: string
  accountId: string
}

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeProduct(value: unknown, fallbackAccountId: string): XhsProductRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const name = normalizeText(record.name)
  const id = normalizeText(record.id) || name
  const accountId = normalizeText(record.accountId) || fallbackAccountId
  if (!id) return null

  return {
    id,
    name,
    price: normalizeText(record.price),
    cover: normalizeText(record.cover),
    productUrl: normalizeText(record.productUrl),
    accountId
  }
}

function normalizeProducts(value: unknown, fallbackAccountId: string): XhsProductRecord[] {
  const list = Array.isArray(value) ? value : []
  const normalized = list
    .map((item) => normalizeProduct(item, fallbackAccountId))
    .filter((p): p is XhsProductRecord => Boolean(p))

  const byId = new Map<string, XhsProductRecord>()
  for (const item of normalized) {
    const key = `${item.accountId}::${item.id}`
    if (!byId.has(key)) byId.set(key, item)
  }
  return Array.from(byId.values())
}

export class ProductManager {
  private sqlite: SqliteService

  constructor(sqlite?: SqliteService) {
    this.sqlite = sqlite ?? SqliteService.getInstance()
  }

  list(accountId?: string): XhsProductRecord[] {
    const normalizedAccountId = typeof accountId === 'string' ? accountId.trim() : ''

    const rows = normalizedAccountId
      ? (this.sqlite.connection
          .prepare(`SELECT id, accountId, name, price, cover, productUrl FROM products WHERE accountId = ?`)
          .all(normalizedAccountId) as Array<Record<string, unknown>>)
      : (this.sqlite.connection
          .prepare(`SELECT id, accountId, name, price, cover, productUrl FROM products`)
          .all() as Array<Record<string, unknown>>)

    return rows
      .map((row) => {
        const id = typeof row.id === 'string' ? row.id : ''
        const rowAccountId = typeof row.accountId === 'string' ? row.accountId : ''
        const name = typeof row.name === 'string' ? row.name : ''
        const price = typeof row.price === 'string' ? row.price : ''
        const cover = typeof row.cover === 'string' ? row.cover : ''
        const productUrl = typeof row.productUrl === 'string' ? row.productUrl : ''
        if (!id || !rowAccountId) return null
        return { id, accountId: rowAccountId, name, price, cover, productUrl }
      })
      .filter((v): v is XhsProductRecord => Boolean(v))
  }

  save(payload: unknown): XhsProductRecord[] {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
    const accountId = record && typeof record.accountId === 'string' ? record.accountId.trim() : ''
    const products = record && 'products' in record ? record.products : payload

    if (accountId) return this.saveForAccount(accountId, products)

    const normalized = normalizeProducts(products, '')

    const db = this.sqlite.connection
    const insertStmt = db.prepare(
      `INSERT OR REPLACE INTO products (id, accountId, name, price, cover, productUrl) VALUES (?, ?, ?, ?, ?, ?)`
    )
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM products`).run()
      for (const p of normalized) {
        insertStmt.run(p.id, p.accountId, p.name, p.price, p.cover, p.productUrl)
      }
    })
    tx()

    return normalized
  }

  saveForAccount(accountId: string, products: unknown): XhsProductRecord[] {
    const normalizedAccountId = accountId.trim()
    const normalized = normalizeProducts(products, normalizedAccountId)

    const db = this.sqlite.connection
    const insertStmt = db.prepare(
      `INSERT OR REPLACE INTO products (id, accountId, name, price, cover, productUrl) VALUES (?, ?, ?, ?, ?, ?)`
    )
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM products WHERE accountId = ?`).run(normalizedAccountId)
      for (const p of normalized) {
        insertStmt.run(p.id, p.accountId, p.name, p.price, p.cover, p.productUrl)
      }
    })
    tx()

    return normalized.filter((p) => p.accountId === normalizedAccountId)
  }
}
