import { useEffect, useState, useCallback } from 'react'

// Generic loading-state hook. Returns { data, error, loading, refresh }.
// `loader` is the async function. The hook re-runs it whenever `deps` change.
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps)
  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    run().then(d => { if (alive) { setData(d); setLoading(false) } })
      .catch(err => { if (alive) { setError(err instanceof Error ? err.message : String(err)); setLoading(false) } })
    return () => { alive = false }
  // tick is a manual refresh trigger; everything else is a real dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, tick])
  return { data, error, loading, refresh: () => setTick(t => t + 1) }
}
