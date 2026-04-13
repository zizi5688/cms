const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const NATIVE_ARTIFACT_EXTENSIONS = ['.node', '.dylib']

function splitPackageName(name) {
  return name.startsWith('@') ? name.split('/').slice(0, 2) : [name]
}

function packageDirFromName(root, name) {
  return path.join(root, ...splitPackageName(name))
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function exists(filePath) {
  try {
    fs.accessSync(filePath)
    return true
  } catch {
    return false
  }
}

function realpathSafe(filePath) {
  try {
    return fs.realpathSync(filePath)
  } catch {
    return filePath
  }
}

function copyDir(sourceDir, targetDir) {
  fs.mkdirSync(path.dirname(targetDir), { recursive: true })
  fs.cpSync(realpathSafe(sourceDir), targetDir, {
    recursive: true,
    force: true,
    dereference: true
  })
}

function removeNestedBinDirs(rootDir) {
  const stack = [rootDir]
  while (stack.length > 0) {
    const currentDir = stack.pop()
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '.bin') {
          fs.rmSync(entryPath, { recursive: true, force: true })
          continue
        }
        stack.push(entryPath)
      }
    }
  }
}

function findPackageRoot(resolvedPath, packageName) {
  let currentDir = resolvedPath
  if (exists(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    currentDir = path.dirname(resolvedPath)
  }

  while (true) {
    const packageJsonPath = path.join(currentDir, 'package.json')
    if (exists(packageJsonPath)) {
      try {
        const meta = readJson(packageJsonPath)
        if (meta.name === packageName) {
          return currentDir
        }
      } catch {}
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return null
}

function resolvePackageDir({ packageName, fromDir, fallbackNodeModulesRoot }) {
  const candidateNames = [`${packageName}/package.json`, packageName]

  for (const candidate of candidateNames) {
    try {
      const resolved = require.resolve(candidate, { paths: [fromDir] })
      const packageRoot = candidate.endsWith('/package.json')
        ? path.dirname(resolved)
        : findPackageRoot(resolved, packageName)
      if (packageRoot) return realpathSafe(packageRoot)
    } catch {}
  }

  const fallbackDir = packageDirFromName(fallbackNodeModulesRoot, packageName)
  if (exists(path.join(fallbackDir, 'package.json'))) {
    return realpathSafe(fallbackDir)
  }
  return null
}

function readRuntimeEntryPackages(projectDir) {
  const packageJsonPath = path.join(projectDir, 'package.json')
  const packageJson = readJson(packageJsonPath)
  return Object.keys(packageJson.dependencies || {}).sort()
}

function collectRuntimeClosure({ nodeModulesRoot, entryPackages }) {
  const visitedKeys = new Set()
  const chosenSources = new Map()
  const orderedPackages = []

  function visit(packageName, fromDir) {
    const sourceDir = resolvePackageDir({
      packageName,
      fromDir,
      fallbackNodeModulesRoot: nodeModulesRoot
    })
    if (!sourceDir) return

    const packageJsonPath = path.join(sourceDir, 'package.json')
    const meta = readJson(packageJsonPath)
    const visitKey = `${packageName}::${sourceDir}`
    if (visitedKeys.has(visitKey)) return
    visitedKeys.add(visitKey)

    if (!chosenSources.has(packageName)) {
      chosenSources.set(packageName, sourceDir)
      orderedPackages.push(packageName)
    }

    const deps = {
      ...(meta.dependencies || {}),
      ...(meta.optionalDependencies || {})
    }

    for (const dependencyName of Object.keys(deps)) {
      visit(dependencyName, sourceDir)
    }
  }

  for (const packageName of entryPackages) {
    visit(packageName, nodeModulesRoot)
  }

  return orderedPackages.map((packageName) => ({
    packageName,
    sourceDir: chosenSources.get(packageName)
  }))
}

function resourcesDirFromContext(context) {
  if (context.electronPlatformName === 'darwin') {
    const appName = `${context.packager.appInfo.productFilename}.app`
    return path.join(context.appOutDir, appName, 'Contents', 'Resources')
  }
  return path.join(context.appOutDir, 'resources')
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function signNativeModules(context, options = {}) {
  const runtimePlatform = options.platform ?? process.platform
  if (runtimePlatform !== 'darwin' || context.electronPlatformName !== 'darwin') {
    return
  }

  const execSyncImpl = options.execSyncImpl ?? execSync
  const logImpl = options.logImpl ?? console.log
  const warnImpl = options.warnImpl ?? console.warn
  const resourcesDir = resourcesDirFromContext(context)

  function walkDir(dir) {
    if (!exists(dir)) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkDir(fullPath)
        continue
      }
      if (!NATIVE_ARTIFACT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        continue
      }
      try {
        execSyncImpl(
          `codesign --sign - --force --preserve-metadata=entitlements ${shellQuote(fullPath)}`,
          { stdio: 'pipe' }
        )
        logImpl(`[afterPack:runtime-deps] codesign native artifact: ${entry.name}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnImpl(`[afterPack:runtime-deps] codesign failed for ${entry.name}: ${message}`)
      }
    }
  }

  logImpl('[afterPack:runtime-deps] signing native artifacts in resources')
  walkDir(resourcesDir)
}

async function afterPack(context) {
  const projectDir = fs.realpathSync(context.packager.projectDir)
  const nodeModulesRoot = path.join(projectDir, 'node_modules')
  const resourcesDir = resourcesDirFromContext(context)
  const externalNodeModulesRoot = path.join(resourcesDir, 'node_modules')
  const entryPackages = readRuntimeEntryPackages(projectDir)

  const closure = collectRuntimeClosure({ nodeModulesRoot, entryPackages })

  for (const { packageName, sourceDir } of closure) {
    const targetDir = packageDirFromName(externalNodeModulesRoot, packageName)
    copyDir(sourceDir, targetDir)
    removeNestedBinDirs(targetDir)
  }

  console.log('[afterPack:runtime-deps] copied runtime closure to external resources node_modules')
  console.log(`[afterPack:runtime-deps] resourcesDir=${resourcesDir}`)
  console.log(`[afterPack:runtime-deps] entryPackages=${entryPackages.length}`)
  console.log(`[afterPack:runtime-deps] copiedPackages=${closure.length}`)
  signNativeModules(context)
}

module.exports = {
  NATIVE_ARTIFACT_EXTENSIONS,
  splitPackageName,
  packageDirFromName,
  readJson,
  exists,
  realpathSafe,
  copyDir,
  removeNestedBinDirs,
  findPackageRoot,
  resolvePackageDir,
  readRuntimeEntryPackages,
  collectRuntimeClosure,
  resourcesDirFromContext,
  signNativeModules,
  default: afterPack
}
