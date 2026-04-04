export type AiStudioProjectIdentityLike = {
  id?: string
  productName?: string | null
  sourceFolderPath?: string | null
  metadata?: Record<string, unknown> | null
}

export type AiStudioProjectContext = {
  projectId: string
  projectRootTaskId: string
  projectName: string
  projectPath: string | null
}

function readProjectMetadataRecord(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  return metadata && typeof metadata === 'object' ? metadata : {}
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function replaceControlCharacters(value: string): string {
  return Array.from(value)
    .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char))
    .join('')
}

export function readProjectContext(
  task: AiStudioProjectIdentityLike | null | undefined
): AiStudioProjectContext | null {
  if (!task) return null
  const metadata = readProjectMetadataRecord(task.metadata)
  const projectRootTaskId = normalizeText(
    metadata.projectRootTaskId ?? metadata.projectId ?? task.id
  )
  if (!projectRootTaskId) return null

  const projectId = normalizeText(metadata.projectId ?? projectRootTaskId) || projectRootTaskId
  const projectName = normalizeText(metadata.projectName ?? task.productName) || '未命名项目'
  const projectPath = normalizeText(metadata.projectPath ?? task.sourceFolderPath) || null

  return {
    projectId,
    projectRootTaskId,
    projectName,
    projectPath
  }
}

export function getTaskProjectScopeId(
  task: AiStudioProjectIdentityLike | null | undefined
): string {
  return readProjectContext(task)?.projectRootTaskId ?? normalizeText(task?.id)
}

export function withProjectContext(
  metadata: Record<string, unknown> | null | undefined,
  project: AiStudioProjectContext | null | undefined
): Record<string, unknown> {
  const next = readProjectMetadataRecord(metadata)
  if (!project) {
    const cleared = { ...next }
    delete cleared.projectId
    delete cleared.projectRootTaskId
    delete cleared.projectName
    delete cleared.projectPath
    return cleared
  }

  return {
    ...next,
    projectId: project.projectId,
    projectRootTaskId: project.projectRootTaskId,
    projectName: project.projectName,
    projectPath: project.projectPath
  }
}

export function sanitizeProjectFolderSegment(value: string): string {
  const sanitized = replaceControlCharacters(normalizeText(value))
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48)
  return sanitized || 'project'
}

export function buildProjectFolderPath(
  workspacePath: string | null | undefined,
  projectName: string,
  projectId: string
): string | null {
  const workspace = normalizeText(workspacePath)
  const normalizedProjectId = normalizeText(projectId)
  if (!workspace || !normalizedProjectId) return null

  const safeWorkspace = workspace.replace(/[\\/]+$/, '')
  const safeName = sanitizeProjectFolderSegment(projectName || 'project')
  const suffix = normalizedProjectId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toLowerCase()
  const folderName = suffix ? `${safeName}-${suffix}` : safeName
  return `${safeWorkspace}/ai-studio/projects/${folderName}`
}

export function createProjectContext(input: {
  taskId: string
  projectName?: string | null
  projectPath?: string | null
}): AiStudioProjectContext {
  const projectRootTaskId = normalizeText(input.taskId)
  return {
    projectId: projectRootTaskId,
    projectRootTaskId,
    projectName: normalizeText(input.projectName) || '未命名项目',
    projectPath: normalizeText(input.projectPath) || null
  }
}
