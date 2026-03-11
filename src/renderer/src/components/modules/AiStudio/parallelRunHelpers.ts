export async function runWithConcurrencyLimit<T, TResult>(
  items: T[],
  concurrencyLimit: number,
  worker: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const normalizedLimit = Math.max(1, Math.floor(Number(concurrencyLimit) || 1))
  const results = new Array<TResult>(items.length)
  let nextIndex = 0

  const consume = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(normalizedLimit, items.length) }, () => consume())
  )

  return results
}
