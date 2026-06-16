import { useMemo, useState } from 'react'
import './App.css'
import { SessionProvider, useSession } from './session'
import { useBoard } from './store'
import { useProjects } from './projectsStore'
import { useSkills } from './skillsStore'
import { useApprovals } from './approvalsStore'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './pages/HomePage'
import { ProjectsPage } from './pages/ProjectsPage'
import { SettingsPage } from './pages/SettingsPage'
import type { Card } from './types'

type View = 'board' | 'projects' | 'settings'

function AppShell() {
  const [view, setView] = useState<View>('board')
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  const { currentUser } = useSession()
  const boardStore = useBoard()
  const projectsStore = useProjects()
  const skillsStore = useSkills()
  const approvalsStore = useApprovals()

  const activeCard: Card | null = useMemo(
    () => (activeCardId ? boardStore.board.cards[activeCardId] ?? null : null),
    [activeCardId, boardStore.board.cards]
  )

  return (
    <div className="app-shell">
      <Sidebar currentView={view} onNavigate={setView} currentUser={currentUser} />
      <main className="main-content">
        {view === 'board' ? (
          <HomePage
            boardStore={boardStore}
            projects={projectsStore.projects}
            approvalsStore={approvalsStore}
            currentUser={currentUser}
            activeCard={activeCard}
            onOpenCard={setActiveCardId}
            onCloseCard={() => setActiveCardId(null)}
          />
        ) : null}
        {view === 'projects' ? (
          <ProjectsPage
            projectsStore={projectsStore}
            boardStore={boardStore}
            onOpenCard={setActiveCardId}
          />
        ) : null}
        {view === 'settings' ? (
          <SettingsPage skillsStore={skillsStore} approvalsStore={approvalsStore} />
        ) : null}
      </main>
    </div>
  )
}

function App() {
  return (
    <SessionProvider>
      <AppShell />
    </SessionProvider>
  )
}

export default App
