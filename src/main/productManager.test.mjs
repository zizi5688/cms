import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

import { SqliteService } from './services/sqliteService.ts'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

function listProducts(db, accountId) {
  return db
    .prepare(`SELECT id, accountId, name FROM products WHERE accountId = ? ORDER BY id`)
    .all(accountId)
}

function saveForAccount(db, accountId, products) {
  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO products (id, accountId, name, price, cover, productUrl) VALUES (?, ?, ?, ?, ?, ?)`
  )
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM products WHERE accountId = ?`).run(accountId)
    for (const product of products) {
      insertStmt.run(
        product.id,
        accountId,
        product.name,
        product.price ?? '',
        product.cover ?? '',
        product.productUrl ?? ''
      )
    }
  })
  tx()
}

test('legacy products table migrates to account-scoped keys so sync survives across accounts', async (t) => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'cms-products-'))
  const sqlitePath = join(workspacePath, 'cms.sqlite')
  const legacyDb = new Database(sqlitePath)

  legacyDb.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      name TEXT NOT NULL,
      price TEXT NOT NULL,
      cover TEXT NOT NULL,
      productUrl TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_products_accountId ON products (accountId);
  `)

  legacyDb
    .prepare(`INSERT INTO products (id, accountId, name, price, cover, productUrl) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('shared-product', 'acc-a', '账号A商品', '', '', '')
  legacyDb.close()

  const sqlite = SqliteService.getInstance()
  t.after(async () => {
    sqlite.close()
    await rm(workspacePath, { recursive: true, force: true })
  })

  await sqlite.init(workspacePath)

  saveForAccount(sqlite.connection, 'acc-b', [
    {
      id: 'shared-product',
      name: '账号B商品',
      price: '',
      cover: '',
      productUrl: ''
    }
  ])

  assert.deepEqual(listProducts(sqlite.connection, 'acc-a'), [
    { id: 'shared-product', accountId: 'acc-a', name: '账号A商品' }
  ])
  assert.deepEqual(listProducts(sqlite.connection, 'acc-b'), [
    { id: 'shared-product', accountId: 'acc-b', name: '账号B商品' }
  ])

  const columns = sqlite.connection.prepare(`PRAGMA table_info(products)`).all()
  const accountIdColumn = columns.find((column) => column.name === 'accountId')
  const idColumn = columns.find((column) => column.name === 'id')

  assert.equal(accountIdColumn?.pk, 1)
  assert.equal(idColumn?.pk, 2)
})
