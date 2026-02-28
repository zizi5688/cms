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

function isWindowsExecutable(filePath) {
  try {
    const header = fs.readFileSync(filePath)
    return header.length >= 2 && header[0] === 0x4d && header[1] === 0x5a
  } catch {
    return false
  }
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

function mustBeWindowsBinary(filePath, label) {
  mustExist(filePath, label)
  if (!isWindowsExecutable(filePath)) {
    fail(`${label} is not a Windows executable (MZ): ${filePath}`)
  }
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

const sharpBinaryPath = path.join(
  imgDir,
  'sharp-win32-x64',
  'lib',
  'sharp-win32-x64.node'
)
mustBeWindowsBinary(sharpBinaryPath, 'sharp runtime binary')

const resourcesDir = path.join(unpackDir, 'resources')
const bundledEnginePath = ['cms_engine.exe', 'cms_engine']
  .map((name) => path.join(resourcesDir, name))
  .find((candidate) => fs.existsSync(candidate))

if (!bundledEnginePath) {
  fail(`Missing bundled cms_engine in package resources: ${resourcesDir}`)
}

if (!isWindowsExecutable(bundledEnginePath)) {
  fail(`Bundled cms_engine is not a Windows executable (MZ): ${bundledEnginePath}`)
}

const realEsrganExe = path.join(resourcesDir, 'realesrgan', 'realesrgan-ncnn-vulkan.exe')
mustBeWindowsBinary(realEsrganExe, 'Real-ESRGAN executable')
mustBeNonEmptyFile(
  path.join(resourcesDir, 'realesrgan', 'models', 'realesrgan-x4plus.param'),
  'Real-ESRGAN model param'
)
mustBeNonEmptyFile(
  path.join(resourcesDir, 'realesrgan', 'models', 'realesrgan-x4plus.bin'),
  'Real-ESRGAN model bin'
)

const appNodeModulesDir = path.join(
  unpackDir,
  'resources',
  'app.asar.unpacked',
  'node_modules'
)
const ffmpegCandidates = [
  path.join(appNodeModulesDir, 'ffmpeg-static', 'ffmpeg.exe'),
  path.join(appNodeModulesDir, 'ffmpeg-static', 'ffmpeg')
]
const ffmpegPath = ffmpegCandidates.find((candidate) => fs.existsSync(candidate))
if (!ffmpegPath) {
  fail(`Missing ffmpeg binary. Tried: ${ffmpegCandidates.join(', ')}`)
}
mustBeWindowsBinary(ffmpegPath, 'ffmpeg binary')

const ffprobePath = path.join(
  appNodeModulesDir,
  'ffprobe-static',
  'bin',
  'win32',
  'x64',
  'ffprobe.exe'
)
mustBeWindowsBinary(ffprobePath, 'ffprobe binary')

const sqliteNodePath = path.join(
  appNodeModulesDir,
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
)
mustBeWindowsBinary(sqliteNodePath, 'better-sqlite3 native module')

info(`PASS: version=${version}, installer=${installerName}, arch=${expectedArch}`)
