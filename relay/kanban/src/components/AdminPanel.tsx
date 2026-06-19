import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../session'
import {
  createRole,
  getAdminFlags,
  getAdminRoles,
  getAdminUsers,
  saveFlag,
  setUserLocked,
  setUserRoles,
  type AdminUser,
  type FlagDefinition,
  type Role,
} from '../flagsApi'

export function AdminPanel() {
  const { sessionId } = useSession()
  const [flags, setFlags] = useState<FlagDefinition[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newRole, setNewRole] = useState('')

  const sid = sessionId ?? ''

  const load = useCallback(async () => {
    if (!sid) return
    try {
      setError(null)
      const [f, r, u] = await Promise.all([getAdminFlags(sid), getAdminRoles(sid), getAdminUsers(sid)])
      setFlags(f)
      setRoles(r)
      setUsers(u)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load admin data')
    }
  }, [sid])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(t)
  }, [load])

  const persistFlag = async (next: FlagDefinition) => {
    setFlags((fs) => fs.map((f) => (f.key === next.key ? next : f)))
    try {
      await saveFlag(sid, next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save flag')
    }
  }

  const toggleFlagRole = (flag: FlagDefinition, role: string) => {
    const allowedRoles = flag.allowedRoles.includes(role)
      ? flag.allowedRoles.filter((r) => r !== role)
      : [...flag.allowedRoles, role]
    void persistFlag({ ...flag, allowedRoles })
  }

  const toggleUserLock = async (user: AdminUser) => {
    const locked = !user.locked
    setUsers((us) => us.map((u) => (u.id === user.id ? { ...u, locked } : u)))
    try {
      await setUserLocked(sid, user.id, locked)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update lock state')
      await load() // revert optimistic update
    }
  }

  const toggleUserRole = async (user: AdminUser, role: string) => {
    const nextRoles = user.roles.includes(role)
      ? user.roles.filter((r) => r !== role)
      : [...user.roles, role]
    setUsers((us) => us.map((u) => (u.id === user.id ? { ...u, roles: nextRoles } : u)))
    try {
      await setUserRoles(sid, user.id, nextRoles)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update roles')
    }
  }

  const box = { border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 } as const

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error ? <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div> : null}

      {/* Flags */}
      <section className="panel" style={{ padding: 12 }}>
        <h3 style={{ marginBottom: 8 }}>Feature flags</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {flags.map((flag) => (
            <div key={flag.key} style={box}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>{flag.name}</strong>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{flag.description}</div>
                  <code style={{ fontSize: 11, color: '#94a3b8' }}>{flag.key}</code>
                </div>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={flag.enabled}
                    onChange={(e) => void persistFlag({ ...flag, enabled: e.target.checked })}
                  />
                  Enabled
                </label>
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  Roles {flag.allowedRoles.length === 0 ? '(empty = everyone)' : ''}:
                </span>
                {roles.map((r) => (
                  <label key={r.name} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={flag.allowedRoles.includes(r.name)}
                      onChange={() => toggleFlagRole(flag, r.name)}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {flags.length === 0 ? <div style={{ color: '#64748b', fontSize: 13 }}>No flags.</div> : null}
        </div>
      </section>

      {/* Roles */}
      <section className="panel" style={{ padding: 12 }}>
        <h3 style={{ marginBottom: 8 }}>Roles</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {roles.map((r) => (
            <span key={r.name} className="badge" style={{ background: '#f1f5f9', color: '#334155' }}>
              {r.name}
            </span>
          ))}
        </div>
        <div className="modal-subtask-add">
          <input
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="New role name (e.g. paralegal)"
            style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              if (!newRole.trim()) return
              try {
                await createRole(sid, newRole.trim(), '')
                setNewRole('')
                await load()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to create role')
              }
            }}
          >
            Add role
          </button>
        </div>
      </section>

      {/* Users */}
      <section className="panel" style={{ padding: 12 }}>
        <h3 style={{ marginBottom: 8 }}>Users &amp; roles</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {users.map((u) => (
            <div key={u.id} style={{ ...box, opacity: u.locked ? 0.65 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                  {u.name}
                  {u.locked ? (
                    <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>
                      Locked
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={u.locked ? 'btn btn-ghost' : 'btn btn-danger'}
                  onClick={() => void toggleUserLock(u)}
                >
                  {u.locked ? 'Unlock' : 'Lock'}
                </button>
              </div>
              <div style={{ color: '#64748b', fontSize: 12 }}>{u.email}</div>
              <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 6 }}>
                {u.domain ? `${u.domain} · ` : ''}
                {u.lastLoginAt ? `last login ${new Date(u.lastLoginAt).toLocaleString()}` : 'no login record'}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {roles.map((r) => (
                  <label key={r.name} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={u.roles.includes(r.name)}
                      onChange={() => void toggleUserRole(u, r.name)}
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {users.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>No users found.</div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
