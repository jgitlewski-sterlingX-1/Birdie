import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { SessionProvider, useSession } from './session'
import { useBoard } from './store'
import { useProjects } from './projectsStore'
import { useSkills } from './skillsStore'
import { useApprovals } from './approvalsStore'
import { pollNewEmails } from './integrationsApi'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './pages/HomePage'
import { ProjectsPage } from './pages/ProjectsPage'
import { SettingsPage } from './pages/SettingsPage'
import { LoginPage } from './pages/LoginPage'
import type { Card } from './types'

type View = 'board' | 'projects' | 'settings'

function AuthenticatedShell() {
  const [view, setView] = useState<View>('board')
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  const { currentUser, sessionId } = useSession()

  const boardStore = useBoard()
  const projectsStore = useProjects()
  const skillsStore = useSkills()
  const approvalsStore = useApprovals()

  const activeCard: Card | null = useMemo(
    () => (activeCardId ? boardStore.board.cards[activeCardId] ?? null : null),
    [activeCardId, boardStore.board.cards]
  )

  useEffect(() => {
    if (!sessionId) return

    let cancelled = false

    const syncEmails = async () => {
      try {
        const emails = await pollNewEmails(sessionId)
        if (cancelled || emails.length === 0) return

        for (const email of emails) {
          boardStore.addCard('col-new', {
            title: email.subject,
            description: email.snippet || 'New Gmail message',
            source: 'gmail',
            provider: 'gmail',
            externalId: email.messageId,
            emailThread: [
              {
                from: email.from,
                date: email.date,
                body: email.body || email.snippet,
              },
            ],
            replyMeta: {
              threadId: email.threadId,
              to: email.from,
              subject: email.subject,
              messageId: email.messageId,
            },
          })
        }
      } catch (error) {
        console.error('[Email Agent] Poll failed:', error)
      }
    }

    void syncEmails()
    const timer = window.setInterval(() => {
      void syncEmails()
    }, 30000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [sessionId, boardStore.addCard])

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

function AppShell() {
  const { authenticated } = useSession()

  if (!authenticated) {
    return <LoginPage />
  }

  return <AuthenticatedShell />
}

function App() {
  return (
    <SessionProvider>
      <AppShell />
    </SessionProvider>
  )
}

export default App
