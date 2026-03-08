const fs = require('node:fs')
const path = require('node:path')

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

function copyDir(sourceDir, targetDir) {
  fs.mkdirSync(path.dirname(targetDir), { recursive: true })
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true, dereference: true })
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
      if (packageRoot) return packageRoot
    } catch {}
  }

  const fallbackDir = packageDirFromName(fallbackNodeModulesRoot, packageName)
  if (exists(path.join(fallbackDir, 'package.json'))) {
    return fallbackDir
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
  }

  console.log('[afterPack:runtime-deps] copied runtime closure to external resources node_modules')
  console.log(`[afterPack:runtime-deps] resourcesDir=${resourcesDir}`)
  console.log(`[afterPack:runtime-deps] entryPackages=${entryPackages.length}`)
  console.log(`[afterPack:runtime-deps] copiedPackages=${closure.length}`)
}

module.exports = {
  splitPackageName,
  packageDirFromName,
  readJson,
  exists,
  copyDir,
  findPackageRoot,
  resolvePackageDir,
  readRuntimeEntryPackages,
  collectRuntimeClosure,
  resourcesDirFromContext,
  default: afterPack
}
