import type { User } from '../types'
import { useSession } from '../session'

type View = 'board' | 'projects' | 'process-manager' | 'settings'

interface SidebarProps {
  currentView: View
  onNavigate: (view: View) => void
  currentUser: User
}

export function Sidebar({ currentView, onNavigate, currentUser }: SidebarProps) {
  const { authenticated, authUser, logout } = useSession()

  return (
    <aside className="sidebar">
      <div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Relay</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          {authUser ? authUser.domain : 'Sterling Lawyers'}
        </div>
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
          active={currentView === 'process-manager'}
          label="Process Manager"
          onClick={() => onNavigate('process-manager')}
        />
        <SidebarButton
          active={currentView === 'settings'}
          label="Settings"
          onClick={() => onNavigate('settings')}
        />
      </nav>

      <div className="sidebar-footer">
        {authenticated ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span className="avatar" style={{ background: currentUser.avatarColor }}>
                {currentUser.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{currentUser.name}</div>
                <div style={{ color: '#94a3b8', fontSize: 12 }}>{currentUser.email}</div>
              </div>
            </div>
            <button
              onClick={logout}
              className="logout-button"
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              Logout
            </button>
          </div>
        ) : null}
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
