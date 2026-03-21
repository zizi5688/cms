export type PublishQueueRunResult = {
  processed: number
  succeeded: number
  failed: number
}

type QueueRunInput = {
  accountId?: string
}

type QueueRunRequest<TOptions extends QueueRunInput> = {
  key: string
  options: TOptions
  reject: (error?: unknown) => void
  resolve: (value: PublishQueueRunResult) => void
}

export function createPublishQueueScheduler<TOptions extends QueueRunInput>(
  runner: (options: TOptions) => Promise<PublishQueueRunResult>
): {
  enqueue: (options: TOptions) => Promise<PublishQueueRunResult>
  isBusy: () => boolean
} {
  const queuedOrRunningByKey = new Map<string, Promise<PublishQueueRunResult>>()
  const pending: Array<QueueRunRequest<TOptions>> = []
  let active = false

  const pump = (): void => {
    if (active) return
    const next = pending.shift()
    if (!next) return

    active = true
    void runner(next.options)
      .then((result) => {
        next.resolve(result)
      })
      .catch((error) => {
        next.reject(error)
      })
      .finally(() => {
        queuedOrRunningByKey.delete(next.key)
        active = false
        pump()
      })
  }

  return {
    enqueue(options: TOptions): Promise<PublishQueueRunResult> {
      const normalizedAccountId = typeof options.accountId === 'string' ? options.accountId.trim() : ''
      const normalizedOptions =
        normalizedAccountId && normalizedAccountId !== options.accountId
          ? ({ ...options, accountId: normalizedAccountId } as TOptions)
          : options
      const key = normalizedAccountId || '__global__'
      const existing = queuedOrRunningByKey.get(key)
      if (existing) return existing

      let resolvePromise: ((value: PublishQueueRunResult) => void) | null = null
      let rejectPromise: ((error?: unknown) => void) | null = null
      const promise = new Promise<PublishQueueRunResult>((resolve, reject) => {
        resolvePromise = resolve
        rejectPromise = reject
      })

      queuedOrRunningByKey.set(key, promise)
      pending.push({
        key,
        options: normalizedOptions,
        resolve: (value) => resolvePromise?.(value),
        reject: (error) => rejectPromise?.(error)
      })
      pump()
      return promise
    },
    isBusy(): boolean {
      return active || pending.length > 0
    }
  }
}
