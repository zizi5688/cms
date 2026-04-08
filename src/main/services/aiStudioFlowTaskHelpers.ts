function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const AI_STUDIO_FLOW_TASK_SUBMIT_PATH = '/v1/flow/tasks'
export const AI_STUDIO_FLOW_TASK_POLL_PATH = '/v1/flow/tasks/{task_id}'

export function isAiStudioAsyncFlowRoute(input: {
  model?: string | null
  endpointPath?: string | null
}): boolean {
  const normalizedModel = normalizeText(input.model).toLowerCase()
  const normalizedEndpointPath = normalizeText(input.endpointPath).toLowerCase()

  return (
    normalizedModel === 'flow-web-image' ||
    normalizedEndpointPath === '/v1beta/models/flow-web-image:generatecontent'
  )
}

export function buildAiStudioAsyncFlowSubmitPayload(input: {
  model?: string | null
  requestPayload?: Record<string, unknown> | null
}): Record<string, unknown> {
  return {
    publicModel: normalizeText(input.model) || 'flow-web-image',
    ...((input.requestPayload && typeof input.requestPayload === 'object'
      ? input.requestPayload
      : {}) as Record<string, unknown>)
  }
}

export function normalizeAiStudioAsyncFlowTaskPayload(
  payload: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {}

  const response =
    payload.response && typeof payload.response === 'object'
      ? (payload.response as Record<string, unknown>)
      : null

  if (!response) {
    return { ...payload }
  }

  return {
    ...response,
    status: normalizeText(payload.status) || normalizeText(response.status),
    ...(payload.error !== undefined ? { error: payload.error } : {}),
    ...(payload.taskId !== undefined ? { taskId: payload.taskId } : {}),
    ...(payload.task_id !== undefined ? { task_id: payload.task_id } : {}),
    ...(payload.id !== undefined ? { id: payload.id } : {})
  }
}
