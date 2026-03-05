#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

function normalizeText(value) {
  return String(value ?? '').trim()
}

function parseArgs(argv) {
  const options = {
    dbPath: '',
    snapshotDate: '2026-03-04',
    keyword: '显瘦神裤',
    finalFile: '',
    dryRun: false
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--db') {
      options.dbPath = normalizeText(argv[i + 1])
      i += 1
      continue
    }
    if (arg === '--date') {
      options.snapshotDate = normalizeText(argv[i + 1])
      i += 1
      continue
    }
    if (arg === '--keyword') {
      options.keyword = normalizeText(argv[i + 1])
      i += 1
      continue
    }
    if (arg === '--final-file') {
      options.finalFile = normalizeText(argv[i + 1])
      i += 1
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
  }

  return options
}

function sqlQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`
}

function runSql(dbPath, sql, separator = '|') {
  const output = execFileSync('sqlite3', ['-batch', '-noheader', '-separator', separator, dbPath, sql], {
    encoding: 'utf8'
  })
  return output.trim()
}

function tableExists(dbPath, tableName) {
  const result = runSql(
    dbPath,
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${sqlQuote(tableName)} LIMIT 1;`
  )
  return result === '1'
}

function readStats(dbPath, snapshotDate, keyword) {
  const qDate = sqlQuote(snapshotDate)
  const qKeyword = sqlQuote(keyword)

  const totalHits =
    Number(
      runSql(
        dbPath,
        `SELECT COUNT(*)
         FROM scout_dashboard_keyword_hits
         WHERE snapshot_date = ${qDate} AND keyword = ${qKeyword};`
      ) || 0
    ) || 0

  const zeroCount =
    Number(
      runSql(
        dbPath,
        `SELECT COUNT(*)
         FROM scout_dashboard_keyword_hits h
         INNER JOIN scout_dashboard_snapshot_rows s
           ON s.snapshot_date = h.snapshot_date
          AND s.product_key = h.product_key
         WHERE h.snapshot_date = ${qDate}
           AND h.keyword = ${qKeyword}
           AND COALESCE(s.add_cart_24h_value, 0) = 0;`
      ) || 0
    ) || 0

  const bySourceRaw = runSql(
    dbPath,
    `SELECT COALESCE(h.source_file, ''),
            COUNT(*),
            SUM(CASE WHEN COALESCE(s.add_cart_24h_value, 0) = 0 THEN 1 ELSE 0 END)
     FROM scout_dashboard_keyword_hits h
     LEFT JOIN scout_dashboard_snapshot_rows s
       ON s.snapshot_date = h.snapshot_date
      AND s.product_key = h.product_key
     WHERE h.snapshot_date = ${qDate}
       AND h.keyword = ${qKeyword}
     GROUP BY h.source_file
     ORDER BY COUNT(*) DESC, h.source_file ASC;`,
    '\t'
  )

  const bySource = bySourceRaw
    ? bySourceRaw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [sourceFile = '', total = '0', zero = '0'] = line.split('\t')
          return {
            sourceFile: normalizeText(sourceFile) || '(empty)',
            total: Number(total) || 0,
            zeroCount: Number(zero) || 0
          }
        })
    : []

  return { totalHits, zeroCount, bySource }
}

function cleanupKeywordSnapshot(dbPath, snapshotDate, keyword, options) {
  const qDate = sqlQuote(snapshotDate)
  const qKeyword = sqlQuote(keyword)

  const statements = [
    'BEGIN IMMEDIATE;',
    'CREATE TEMP TABLE IF NOT EXISTS tmp_target_product_keys (product_key TEXT PRIMARY KEY);',
    'DELETE FROM tmp_target_product_keys;',
    `INSERT OR IGNORE INTO tmp_target_product_keys (product_key)
     SELECT DISTINCT product_key
     FROM scout_dashboard_keyword_hits
     WHERE snapshot_date = ${qDate} AND keyword = ${qKeyword};`,
    "SELECT 'touchedProductKeys', COUNT(*) FROM tmp_target_product_keys;",
    `DELETE FROM scout_dashboard_keyword_hits
     WHERE snapshot_date = ${qDate} AND keyword = ${qKeyword};`,
    "SELECT 'deletedKeywordHits', changes();",
    `DELETE FROM scout_dashboard_snapshot_rows
     WHERE snapshot_date = ${qDate}
       AND product_key IN (SELECT product_key FROM tmp_target_product_keys)
       AND NOT EXISTS (
         SELECT 1
         FROM scout_dashboard_keyword_hits h
         WHERE h.snapshot_date = ${qDate}
           AND h.product_key = scout_dashboard_snapshot_rows.product_key
       );`,
    "SELECT 'deletedSnapshotRows', changes();"
  ]

  if (options.hasWatchlist) {
    statements.push(
      `DELETE FROM scout_dashboard_watchlist
       WHERE snapshot_date = ${qDate}
         AND product_key IN (SELECT product_key FROM tmp_target_product_keys)
         AND NOT EXISTS (
           SELECT 1
           FROM scout_dashboard_snapshot_rows s
           WHERE s.snapshot_date = ${qDate}
             AND s.product_key = scout_dashboard_watchlist.product_key
         );`,
      "SELECT 'deletedWatchlistRows_1', changes();",
      `DELETE FROM scout_dashboard_watchlist
       WHERE snapshot_date = ${qDate}
         AND NOT EXISTS (
           SELECT 1
           FROM scout_dashboard_snapshot_rows s
           WHERE s.snapshot_date = scout_dashboard_watchlist.snapshot_date
             AND s.product_key = scout_dashboard_watchlist.product_key
         );`,
      "SELECT 'deletedWatchlistRows_2', changes();"
    )
  } else {
    statements.push("SELECT 'deletedWatchlistRows_1', 0;", "SELECT 'deletedWatchlistRows_2', 0;")
  }

  statements.push(
    `DELETE FROM scout_dashboard_product_map
     WHERE product_key IN (SELECT product_key FROM tmp_target_product_keys)
       AND NOT EXISTS (
         SELECT 1
         FROM scout_dashboard_snapshot_rows s
         WHERE s.product_key = scout_dashboard_product_map.product_key
       );`,
    "SELECT 'deletedProductMapRows', changes();"
  )

  if (options.hasCoverCache) {
    statements.push(
      `DELETE FROM scout_dashboard_cover_cache
       WHERE product_key IN (SELECT product_key FROM tmp_target_product_keys)
         AND NOT EXISTS (
           SELECT 1
           FROM scout_dashboard_snapshot_rows s
           WHERE s.product_key = scout_dashboard_cover_cache.product_key
         );`,
      "SELECT 'deletedCoverCacheRows', changes();"
    )
  } else {
    statements.push("SELECT 'deletedCoverCacheRows', 0;")
  }

  statements.push('COMMIT;')

  const resultRaw = runSql(dbPath, statements.join('\n'), '\t')
  const rows = resultRaw
    ? resultRaw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.split('\t'))
    : []

  const map = new Map(rows.map(([k, v]) => [normalizeText(k), Number(v) || 0]))

  return {
    touchedProductKeys: map.get('touchedProductKeys') || 0,
    deletedKeywordHits: map.get('deletedKeywordHits') || 0,
    deletedSnapshotRows: map.get('deletedSnapshotRows') || 0,
    deletedWatchlistRows:
      (map.get('deletedWatchlistRows_1') || 0) + (map.get('deletedWatchlistRows_2') || 0),
    deletedProductMapRows: map.get('deletedProductMapRows') || 0,
    deletedCoverCacheRows: map.get('deletedCoverCacheRows') || 0
  }
}

function touchFile(filePath) {
  const now = new Date()
  fs.utimesSync(filePath, now, now)
}

function printUsage() {
  const cmd = path.basename(process.argv[1] || 'cleanup-scout-dashboard-keyword.cjs')
  console.log(`Usage:\n  node scripts/${cmd} --db /path/to/cms.sqlite [--date 2026-03-04] [--keyword 显瘦神裤] [--final-file /path/to/final.xlsx] [--dry-run]`)
}

function main() {
  const options = parseArgs(process.argv)
  if (!options.dbPath) {
    printUsage()
    process.exitCode = 1
    return
  }

  const dbPath = path.resolve(options.dbPath)
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`)
  }

  if (options.finalFile) {
    const finalFilePath = path.resolve(options.finalFile)
    if (!fs.existsSync(finalFilePath)) {
      throw new Error(`Final Excel file not found: ${finalFilePath}`)
    }
    options.finalFile = finalFilePath
  }

  const requiredTables = ['scout_dashboard_keyword_hits', 'scout_dashboard_snapshot_rows', 'scout_dashboard_product_map']
  for (const tableName of requiredTables) {
    if (!tableExists(dbPath, tableName)) {
      throw new Error(`Missing required table: ${tableName}`)
    }
  }

  const hasWatchlist = tableExists(dbPath, 'scout_dashboard_watchlist')
  const hasCoverCache = tableExists(dbPath, 'scout_dashboard_cover_cache')

  const before = readStats(dbPath, options.snapshotDate, options.keyword)
  console.log('[before]')
  console.log(`hits=${before.totalHits}, zero24h=${before.zeroCount}`)
  if (before.bySource.length > 0) {
    console.log('[before.bySource]')
    for (const row of before.bySource) {
      console.log(`${row.sourceFile}\ttotal=${row.total}\tzero24h=${row.zeroCount}`)
    }
  }

  if (options.dryRun) {
    console.log('[dry-run] no changes applied')
    return
  }

  const cleanup = cleanupKeywordSnapshot(dbPath, options.snapshotDate, options.keyword, {
    hasWatchlist,
    hasCoverCache
  })
  console.log('[cleanup]')
  console.log(JSON.stringify(cleanup))

  const after = readStats(dbPath, options.snapshotDate, options.keyword)
  console.log('[after]')
  console.log(`hits=${after.totalHits}, zero24h=${after.zeroCount}`)

  if (options.finalFile) {
    touchFile(options.finalFile)
    console.log(`[reimport-trigger] touched final file mtime: ${options.finalFile}`)
    console.log('[reimport-trigger] if XHS Console is running with auto-import enabled, this file will be imported in next scan.')
  } else {
    console.log('[next-step] reimport final workbook manually (or provide --final-file to trigger auto-import by mtime touch).')
  }
}

main()
