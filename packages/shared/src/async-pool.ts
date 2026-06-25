/**
 * Run async work over a list with a bounded number of in-flight tasks (rate-limit friendly).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const cap = Math.max(1, Math.floor(limit))
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  let running = 0
  let completed = 0

  return new Promise((resolve, reject) => {
    const kick = (): void => {
      while (running < cap && nextIndex < items.length) {
        const i = nextIndex++
        running++
        void Promise.resolve(fn(items[i]!, i))
          .then((r) => {
            results[i] = r
            running--
            completed++
            if (completed === items.length) resolve(results)
            else kick()
          })
          .catch(reject)
      }
    }
    kick()
  })
}
