import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { SessionProvider, useSession } from './session'
import { useBoard } from './store'
import { useProjects } from './projectsStore'
import { useSkills } from './skillsStore'
import { useApprovals } from './approvalsStore'
import { pollNewEmails } from './integrationsApi'
import { runEmailPipeline } from './emailSkill'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './pages/HomePage'
import { ProjectsPage } from './pages/ProjectsPage'
import { SettingsPage } from './pages/SettingsPage'
import { LoginPage } from './pages/LoginPage'
import type { Card } from './types'

type View = 'board' | 'projects' | 'settings'

interface IncomingEmail {
  subject: string
  snippet: string
  from: string
  date: string
  body: string
  messageId: string
  threadId: string
}

// Demo email used by the "Simulate incoming email" button so the base skill
// pipeline is testable without a live Gmail sync.
const SAMPLE_EMAIL: IncomingEmail = {
  subject: 'Settlement agreement — review needed before Friday',
  snippet: 'Could you please review the attached settlement agreement…',
  from: 'counsel@opposingfirm.com',
  date: new Date().toISOString(),
  body:
    'Hi Jay, Could you please review the attached settlement agreement and confirm the closing date by Friday? ' +
    'Also, can you send the signed disclosure form to opposing counsel before end of week? ' +
    'Let me know if you have any questions. Thanks, Pat',
  messageId: `demo-${Math.random().toString(36).slice(2, 10)}`,
  threadId: `demo-thread-${Math.random().toString(36).slice(2, 10)}`,
}

function AuthenticatedShell() {
  const [view, setView] = useState<View>('board')
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  const { currentUser, sessionId } = useSession()

  const boardStore = useBoard()
  const projectsStore = useProjects()
  const skillsStore = useSkills()
  const approvalsStore = useApprovals()

  const { addCard, updateCard, addSubtask } = boardStore

  // Current custom email skills, read without re-subscribing the poller.
  const { customSkills } = skillsStore
  const skillsRef = useRef(customSkills)
  useEffect(() => {
    skillsRef.current = customSkills
  }, [customSkills])

  // Latest board, read in the poller without re-subscribing it (for dedup).
  const boardRef = useRef(boardStore.board)
  useEffect(() => {
    boardRef.current = boardStore.board
  }, [boardStore.board])

  // User-visible status of the last email pull.
  const [pollStatus, setPollStatus] = useState<string | null>(null)

  const activeCard: Card | null = useMemo(
    () => (activeCardId ? boardStore.board.cards[activeCardId] ?? null : null),
    [activeCardId, boardStore.board.cards]
  )

  // Turn an incoming email into a card, then run the email skill pipeline:
  // base triage first (summary + to-dos), then any enabled custom email skills.
  const ingestEmailCard = useCallback(
    (email: IncomingEmail) => {
      const emailThread = [
        { from: email.from, date: email.date, body: email.body || email.snippet },
      ]
      const cardId = addCard('col-new', {
        title: email.subject,
        description: email.snippet || 'New Gmail message',
        source: 'gmail',
        provider: 'gmail',
        externalId: email.messageId,
        emailThread,
        replyMeta: {
          threadId: email.threadId,
          to: email.from,
          subject: email.subject,
          messageId: email.messageId,
        },
      })

      const emailSkills = skillsRef.current.filter(
        (s) => s.category === 'email' && s.enabled
      )
      const { summary, todoTitles, skillsApplied } = runEmailPipeline(emailThread, emailSkills)
      updateCard(cardId, { summary, todosExtracted: true, skillsApplied })
      todoTitles.forEach((title) => addSubtask(cardId, title))
      return cardId
    },
    [addCard, updateCard, addSubtask]
  )

  // Pull the inbox and ingest any emails not already on the board. Surfaces a
  // visible status so failures (stale session, Gmail not connected) aren't silent.
  const pullInbox = useCallback(async () => {
    if (!sessionId) {
      setPollStatus('Not signed in')
      return
    }
    setPollStatus('Pulling inbox…')
    try {
      const emails = await pollNewEmails(sessionId)
      const existingExternalIds = new Set(
        Object.values(boardRef.current.cards)
          .map((c) => c.externalId)
          .filter(Boolean)
      )
      const fresh = emails.filter((e) => !existingExternalIds.has(e.messageId))
      fresh.forEach((email) => ingestEmailCard(email as IncomingEmail))

      if (emails.length === 0) {
        setPollStatus('No emails returned — inbox empty, already seen this session, or Gmail not connected.')
      } else if (fresh.length === 0) {
        setPollStatus(`All ${emails.length} pulled email(s) are already on the board.`)
      } else {
        setPollStatus(`Pulled ${fresh.length} new email(s).`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Poll failed'
      setPollStatus(`Pull failed: ${message}`)
      console.error('[Email Agent] Poll failed:', error)
    }
  }, [sessionId, ingestEmailCard])

  // Pull on login, then every 30s. The initial pull is deferred off the
  // synchronous effect body so its status update doesn't cascade renders.
  useEffect(() => {
    if (!sessionId) return
    const initial = window.setTimeout(() => void pullInbox(), 0)
    const timer = window.setInterval(() => void pullInbox(), 30000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [sessionId, pullInbox])

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
            onSimulateEmail={() => ingestEmailCard(SAMPLE_EMAIL)}
            onPullInbox={pullInbox}
            pollStatus={pollStatus}
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
