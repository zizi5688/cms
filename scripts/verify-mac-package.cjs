#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

function fail(message) {
  console.error(`[verify-mac-package] FAIL: ${message}`)
  process.exit(1)
}

function info(message) {
  console.log(`[verify-mac-package] ${message}`)
}

function mustExist(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`)
  }
}

function mustBeNonEmptyFile(filePath, label) {
  mustExist(filePath, label)
  const stat = fs.statSync(filePath)
  if (!stat.isFile() || stat.size <= 0) {
    fail(`${label} is empty or invalid: ${filePath}`)
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8'
  })

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  }
}

const releaseDirArg = process.argv[2] || 'release'
const defaultArch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : 'arm64'
const expectedArch = (process.argv[3] || defaultArch).toLowerCase()
const rootDir = process.cwd()
const releaseDir = path.resolve(rootDir, releaseDirArg)
const packageJsonPath = path.join(rootDir, 'package.json')
const appCandidates = [
  path.join(releaseDir, 'mac-arm64', 'Super CMS.app'),
  path.join(releaseDir, 'mac', 'Super CMS.app')
]

mustExist(packageJsonPath, 'package.json')
mustExist(releaseDir, 'release directory')

const version = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version
const latestMacYmlPath = path.join(releaseDir, 'latest-mac.yml')
mustBeNonEmptyFile(latestMacYmlPath, 'latest-mac.yml')

const latestMacYml = fs.readFileSync(latestMacYmlPath, 'utf8')
if (!latestMacYml.includes(`version: ${version}`)) {
  fail(`latest-mac.yml version mismatch. Expected ${version}`)
}

const macPathLine = latestMacYml
  .split(/\r?\n/)
  .find((line) => line.trimStart().startsWith('path: '))

if (!macPathLine) {
  fail('Cannot find "path:" entry in latest-mac.yml')
}

const zipName = macPathLine.replace(/^.*path:\s*/, '').trim()
const zipPath = path.join(releaseDir, zipName)
mustBeNonEmptyFile(zipPath, 'mac auto-update zip artifact')

const dmgCandidates = fs
  .readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.dmg'))
  .map((entry) => path.join(releaseDir, entry.name))

if (dmgCandidates.length === 0) {
  fail(`Missing DMG artifact in ${releaseDir}`)
}

const appPath = appCandidates.find((candidate) => fs.existsSync(candidate))
if (!appPath) {
  fail(`Missing mac app bundle. Tried: ${appCandidates.join(', ')}`)
}

if (expectedArch === 'arm64' && !appPath.includes('mac-arm64')) {
  fail(`Expected arm64 app bundle, got: ${appPath}`)
}

const codesignDetails = runCapture('codesign', ['-dv', '--verbose=4', appPath]).stderr
if (codesignDetails.includes('flags=') && codesignDetails.includes('runtime')) {
  const entitlementsResult = runCapture('codesign', ['-d', '--entitlements', ':-', appPath])
  const entitlementsOutput = `${entitlementsResult.stdout}${entitlementsResult.stderr}`
  if (!entitlementsOutput.includes('com.apple.security.cs.disable-library-validation')) {
    fail('Hardened runtime build is missing com.apple.security.cs.disable-library-validation entitlement')
  }
}

const resourcesDir = path.join(appPath, 'Contents', 'Resources')
const externalNodeModulesDir = path.join(resourcesDir, 'node_modules')
const unpackedNodeModulesDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules')
const asarPath = path.join(resourcesDir, 'app.asar')

mustBeNonEmptyFile(asarPath, 'app.asar')
mustExist(externalNodeModulesDir, 'external runtime node_modules')

const runtimeDeps = [
  ['electron-store/index.js', 'electron-store runtime'],
  ['conf/package.json', 'conf runtime'],
  ['ajv/package.json', 'ajv runtime'],
  ['fast-deep-equal/index.js', 'fast-deep-equal runtime'],
  ['fast-uri/package.json', 'fast-uri runtime'],
  ['require-from-string/package.json', 'require-from-string runtime'],
  ['dot-prop/package.json', 'dot-prop runtime'],
  ['p-limit/package.json', 'p-limit runtime'],
  ['yocto-queue/package.json', 'yocto-queue runtime'],
  ['sharp/package.json', 'sharp runtime'],
  ['detect-libc/package.json', 'detect-libc runtime'],
  ['@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node', 'sharp darwin arm64 native binary'],
  ['@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.42.dylib', 'sharp libvips darwin arm64 dylib']
]

for (const [relativePath, label] of runtimeDeps) {
  mustBeNonEmptyFile(path.join(externalNodeModulesDir, relativePath), label)
}

const unpackedDeps = [
  ['better-sqlite3/build/Release/better_sqlite3.node', 'better-sqlite3 native module'],
  ['ffmpeg-static/ffmpeg', 'ffmpeg binary'],
  ['ffprobe-static/bin/darwin/arm64/ffprobe', 'ffprobe binary']
]

for (const [relativePath, label] of unpackedDeps) {
  mustBeNonEmptyFile(path.join(unpackedNodeModulesDir, relativePath), label)
}

const bundledResources = [
  ['cms_engine', 'cms_engine binary'],
  ['realesrgan/realesrgan-ncnn-vulkan', 'Real-ESRGAN executable'],
  ['realesrgan/models/realesrgan-x4plus.param', 'Real-ESRGAN model param'],
  ['realesrgan/models/realesrgan-x4plus.bin', 'Real-ESRGAN model bin']
]

for (const [relativePath, label] of bundledResources) {
  mustBeNonEmptyFile(path.join(resourcesDir, relativePath), label)
}

const disallowedPrefixes = [
  '/.claude',
  '/.github',
  '/.githooks',
  '/.trae',
  '/.worktrees',
  '/AI_Tools',
  '/dist',
  '/docs',
  '/outputs',
  '/python',
  '/scripts',
  '/skills'
]

const packagedEntries = asar.listPackage(asarPath)
const leakedEntry = packagedEntries.find((entry) => disallowedPrefixes.some((prefix) => entry === prefix || entry.startsWith(`${prefix}/`)))
if (leakedEntry) {
  fail(`Found local-only content in app.asar: ${leakedEntry}`)
}

info(`PASS: app=${appPath}, arch=${expectedArch}, latestMacYml=${latestMacYmlPath}, zip=${zipPath}`)
