import { USERS } from '../users'
import type { User } from '../types'
import { useSession } from '../session'

type View = 'board' | 'projects' | 'settings'

interface SidebarProps {
  currentView: View
  onNavigate: (view: View) => void
  currentUser: User
}

export function Sidebar({ currentView, onNavigate, currentUser }: SidebarProps) {
  const { setCurrentUser } = useSession()

  return (
    <aside className="sidebar">
      <div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Relay</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>Sterling Lawyers</div>
      </div>

      <nav className="sidebar-nav">
        <SidebarButton
          active={currentView === 'board'}
          label="Board"
          onClick={() => onNavigate('board')}
        />
        <SidebarButton
          active={currentView === 'projects'}
          label="Projects"
          onClick={() => onNavigate('projects')}
        />
        <SidebarButton
          active={currentView === 'settings'}
          label="Settings"
          onClick={() => onNavigate('settings')}
        />
      </nav>

      <div className="sidebar-footer">
        <div style={{ fontSize: 12, color: '#94a3b8' }}>Current user</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="avatar" style={{ background: currentUser.avatarColor }}>
            {currentUser.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{currentUser.name}</div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>{currentUser.email}</div>
          </div>
        </div>
        <select
          value={currentUser.id}
          onChange={(e) => {
            const next = USERS.find((u) => u.id === e.target.value)
            if (next) setCurrentUser(next)
          }}
          className="sidebar-select"
        >
          {USERS.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </div>
    </aside>
  )
}

function SidebarButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sidebar-button ${active ? 'active' : ''}`}
    >
      {label}
    </button>
  )
}
