#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

function fail(message) {
  console.error(`[verify-win-package] FAIL: ${message}`)
  process.exit(1)
}

function info(message) {
  console.log(`[verify-win-package] ${message}`)
}

const releaseDirArg = process.argv[2] || 'release'
const expectedArch = (process.argv[3] || 'x64').toLowerCase()
const rootDir = process.cwd()
const releaseDir = path.resolve(rootDir, releaseDirArg)
const packageJsonPath = path.join(rootDir, 'package.json')

if (!fs.existsSync(packageJsonPath)) {
  fail(`Missing package.json in ${rootDir}`)
}

if (!fs.existsSync(releaseDir)) {
  fail(`Missing release directory: ${releaseDir}`)
}

const version = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version
const latestYmlPath = path.join(releaseDir, 'latest.yml')

if (!fs.existsSync(latestYmlPath)) {
  fail(`Missing ${latestYmlPath}`)
}

const latestYml = fs.readFileSync(latestYmlPath, 'utf8')
if (!latestYml.includes(`version: ${version}`)) {
  fail(`latest.yml version mismatch. Expected ${version}`)
}

const pathLine = latestYml
  .split(/\r?\n/)
  .find((line) => line.trimStart().startsWith('path: '))

if (!pathLine) {
  fail('Cannot find "path:" entry in latest.yml')
}

const installerName = pathLine.replace(/^.*path:\s*/, '').trim()
const installerPath = path.join(releaseDir, installerName)
if (!fs.existsSync(installerPath)) {
  fail(`Installer from latest.yml not found: ${installerPath}`)
}

if (expectedArch === 'x64' && !installerName.includes('-x64-')) {
  fail(
    `Installer filename must include "-x64-" for traceability. Got: ${installerName}`
  )
}

const unpackCandidates =
  expectedArch === 'x64'
    ? ['win-unpacked', 'win-x64-unpacked']
    : [`win-${expectedArch}-unpacked`, 'win-unpacked']

const unpackDir = unpackCandidates
  .map((dir) => path.join(releaseDir, dir))
  .find((dir) => fs.existsSync(dir))

if (!unpackDir) {
  fail(
    `Missing unpacked app directory for ${expectedArch}. Tried: ${unpackCandidates.join(', ')}`
  )
}

if (expectedArch === 'x64' && unpackDir.endsWith('win-arm64-unpacked')) {
  fail(`Unexpected ARM64 unpacked output: ${unpackDir}`)
}

const imgDir = path.join(
  unpackDir,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  '@img'
)

if (!fs.existsSync(imgDir)) {
  fail(`Missing @img directory: ${imgDir}`)
}

const imgEntries = fs
  .readdirSync(imgDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const requiredByArch = {
  x64: ['sharp-win32-x64'],
  arm64: ['sharp-win32-arm64']
}

for (const required of requiredByArch[expectedArch] || []) {
  if (!imgEntries.includes(required)) {
    fail(`Missing required runtime package: @img/${required}`)
  }
}

const disallowed = ['sharp-darwin', 'sharp-libvips-darwin', 'sharp-linux']
const foundDisallowed = imgEntries.filter((name) =>
  disallowed.some((prefix) => name.startsWith(prefix))
)

if (foundDisallowed.length > 0) {
  fail(
    `Found non-Windows runtime packages in Windows artifact: ${foundDisallowed.join(', ')}`
  )
}

info(`PASS: version=${version}, installer=${installerName}, arch=${expectedArch}`)
