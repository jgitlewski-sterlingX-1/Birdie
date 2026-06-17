/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useSession } from './session'
import { getFlags, type FlagEvaluation } from './flagsApi'

interface FlagsContextValue {
  loading: boolean
  isAdmin: boolean
  roles: string[]
  has: (key: string) => boolean
  refresh: () => Promise<void>
}

const FlagsContext = createContext<FlagsContextValue>({
  loading: true,
  isAdmin: false,
  roles: [],
  has: () => false,
  refresh: async () => {},
})

export function FlagsProvider({ children }: { children: ReactNode }) {
  const { sessionId } = useSession()
  const [evaluation, setEvaluation] = useState<FlagEvaluation>({ flags: {}, roles: [], isAdmin: false })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setLoading(false)
      return
    }
    try {
      setEvaluation(await getFlags(sessionId))
    } catch {
      // leave prior evaluation; features stay gated off on failure
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const has = useCallback((key: string) => !!evaluation.flags[key], [evaluation])

  return (
    <FlagsContext.Provider
      value={{ loading, isAdmin: evaluation.isAdmin, roles: evaluation.roles, has, refresh }}
    >
      {children}
    </FlagsContext.Provider>
  )
}

export function useFlags(): FlagsContextValue {
  return useContext(FlagsContext)
}

// Gate UI behind a flag: renders children only when the flag is on for this user.
export function Feature({ flag, children }: { flag: string; children: ReactNode }) {
  const { has } = useFlags()
  return has(flag) ? <>{children}</> : null
}
