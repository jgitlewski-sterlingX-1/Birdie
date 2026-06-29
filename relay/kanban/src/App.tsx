import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { SessionProvider, useSession } from './session'
import { useBoard } from './store'
import { useProjects } from './projectsStore'
import { useSkills } from './skillsStore'
import { useApprovals } from './approvalsStore'
import { useAgents } from './agentsStore'
import { useEmailGroups } from './emailGroupsStore'
import { pollNewEmails, pollSlackMessages, markEmailRead } from './integrationsApi'
import { runEmailPipeline } from './emailSkill'
import { triageThread } from './emailTriageApi'
import { fetchDirectoryUsers } from './directoryApi'
import { runSlackPipeline } from './slackSkill'
import { FlagsProvider } from './flags'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './pages/HomePage'
import { ProjectsPage } from './pages/ProjectsPage'
import { SettingsPage } from './pages/SettingsPage'
import { LoginPage } from './pages/LoginPage'
import { ProcessManagerPage } from './pages/ProcessManagerPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { apiFetch } from './apiClient'
import type { Card, Priority, AgentFilter, FilterOperator, User } from './types'

function applyOp(text: string, op: FilterOperator, val: string): boolean {
  switch (op) {
    case 'contains': return text.includes(val);
    case 'not_contains': return !text.includes(val);
    case 'is': return text === val;
  }
}

interface EmailForFilter { from: string; subject: string; body: string }

function applyEmailFilters(email: EmailForFilter, filters: AgentFilter[]): 'skip' | 'escalate' | 'flag' | null {
  for (const f of filters) {
    const val = f.value.toLowerCase().trim();
    if (!val) continue;
    let matches = false;
    switch (f.field) {
      case 'from':
        matches = applyOp(email.from.toLowerCase(), f.operator, val);
        break;
      case 'domain': {
        const domain = email.from.split('@')[1]?.toLowerCase() ?? '';
        matches = applyOp(domain, f.operator, val);
        break;
      }
      case 'subject':
        matches = applyOp(email.subject.toLowerCase(), f.operator, val);
        break;
      case 'keyword':
        matches = (email.subject + ' ' + email.body).toLowerCase().includes(val);
        break;
    }
    if (matches) return f.action;
  }
  return null;
}

type View = 'board' | 'projects' | 'process-manager' | 'settings'

interface IncomingEmail {
  subject: string
  snippet: string
  from: string
  date: string
  body: string
  messageId: string
  threadId: string
  to?: string
  cc?: string
}

// Demo email used by the "Simulate incoming email" button so the base skill
// pipeline is testable without a live Gmail sync.
const SAMPLE_EMAIL: IncomingEmail = {
  subject: 'Settlement agreement — review needed before Friday',
  snippet: 'Could you please review the attached settlement agreement…',
  from: 'Pat Counsel <counsel@opposingfirm.com>',
  to: 'Jay Gitlewski <jay@sterlinglawyers.com>',
  cc: 'Sarah Miller <smiller@sterlinglawyers.com>, Tom Reyes <treyes@opposingfirm.com>',
  date: new Date().toISOString(),
  body:
    'Hi Jay, Could you please review the attached settlement agreement and confirm the closing date by Friday? ' +
    'Also, can you send the signed disclosure form to opposing counsel before end of week? ' +
    'Let me know if you have any questions. Thanks, Pat',
  messageId: `demo-${Math.random().toString(36).slice(2, 10)}`,
  threadId: `demo-thread-${Math.random().toString(36).slice(2, 10)}`,
}

interface IncomingSlackMessage {
  messageId: string
  from: string
  text: string
  permalink?: string | null
}

// Demo Slack message for the "Simulate Slack message" button (testable without
// a live Slack connection).
const SAMPLE_SLACK: IncomingSlackMessage = {
  messageId: `demo-slack-${Math.random().toString(36).slice(2, 10)}`,
  from: 'Alex Rivera',
  text: 'Hey — can you review the Q3 deck before our 2pm and send me your edits? Also please confirm the client call time.',
}

function AuthenticatedShell() {
  const [view, setView] = useState<View>('board')
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  const { currentUser, sessionId } = useSession()

  const boardStore = useBoard()
  const projectsStore = useProjects()
  const skillsStore = useSkills()
  const approvalsStore = useApprovals()
  const agentsStore = useAgents()
  const emailGroupsStore = useEmailGroups()

  const { addCard, updateCard, addSubtask } = boardStore

  // Current custom email skills, read without re-subscribing the poller.
  const { customSkills } = skillsStore
  const skillsRef = useRef(customSkills)
  useEffect(() => {
    skillsRef.current = customSkills
  }, [customSkills])

  // Current ignore rules, read without re-subscribing the poller.
  const { rules } = emailGroupsStore
  const rulesRef = useRef(rules)
  useEffect(() => {
    rulesRef.current = rules
  }, [rules])

  // sessionId ref so async triage callbacks always have the current value.
  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  // Latest board, read in the poller without re-subscribing it (for dedup).
  const boardRef = useRef(boardStore.board)
  useEffect(() => {
    boardRef.current = boardStore.board
  }, [boardStore.board])

  // Google Workspace directory users — fetched once on login, merged with the
  // hardcoded fallback list. If the token pre-dates the directory.readonly scope
  // the server returns needsReauth=true; we show a banner so the user knows to
  // sign out and back in to unlock the full org list.
  const [directoryUsers, setDirectoryUsers] = useState<User[]>([])
  const [directoryNeedsReauth, setDirectoryNeedsReauth] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    fetchDirectoryUsers(sessionId)
      .then(({ users, needsReauth }) => {
        setDirectoryUsers(users)
        setDirectoryNeedsReauth(needsReauth)
      })
      .catch(() => { /* silently fall back to hardcoded USERS */ })
  }, [sessionId])

  // All users come from the Google Workspace directory. While the directory is
  // loading (brief window after login), seed with the current user so the
  // assignee picker isn't empty.
  const mergedUsers = useMemo<User[]>(() => {
    if (directoryUsers.length > 0) return directoryUsers
    if (currentUser.email) return [currentUser]
    return []
  }, [directoryUsers, currentUser])

  // User-visible status of the last email pull.
  const [pollStatus, setPollStatus] = useState<string | null>(null)

  // Voice instructions used for auto-drafting replies (the "Reply Voice" skill).
  const voiceInstructions = useMemo(
    () => skillsStore.allSkills.find((s) => s.id === 'base-email-voice' && s.enabled)?.instructions ?? '',
    [skillsStore.allSkills]
  )

  const activeCard: Card | null = useMemo(
    () => (activeCardId ? boardStore.board.cards[activeCardId] ?? null : null),
    [activeCardId, boardStore.board.cards]
  )

  // Open a card and, if it's a Gmail card, mark the thread as read in Gmail.
  const openCard = useCallback(
    (cardId: string) => {
      setActiveCardId(cardId)
      const card = boardRef.current.cards[cardId]
      if (card?.source === 'gmail' && card.replyMeta?.threadId && sessionId) {
        void markEmailRead(sessionId, card.replyMeta.threadId)
      }
    },
    [sessionId]
  )

  // Turn an incoming email into a card, run the base skill pipeline, then fire
  // an async AI triage call that replaces the placeholder summary with a real
  // Claude-generated thread summary + action items.
  const ingestEmailCard = useCallback(
    (email: IncomingEmail, priorityOverride?: Priority) => {
      const emailThread = [
        {
          from: email.from,
          date: email.date,
          body: email.body || email.snippet,
          ...(email.to ? { to: email.to } : {}),
          ...(email.cc ? { cc: email.cc } : {}),
        },
      ]
      const cardId = addCard('col-new', {
        title: email.subject,
        description: email.snippet || 'New Gmail message',
        source: 'gmail',
        provider: 'gmail',
        externalId: email.messageId,
        priority: priorityOverride,
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
      const { skillsApplied, ignored } = runEmailPipeline(
        emailThread,
        emailSkills,
        rulesRef.current
      )
      if (ignored) {
        updateCard(cardId, { completed: true, skillsApplied })
        return cardId
      }

      // Show a placeholder immediately, then replace with the real AI summary.
      updateCard(cardId, { summary: 'Analyzing thread…', skillsApplied })

      const sid = sessionIdRef.current
      if (sid) {
        triageThread(sid, { messages: emailThread, subject: email.subject })
          .then(({ summary, todoTitles }) => {
            updateCard(cardId, { summary, todosExtracted: true })
            todoTitles.forEach((title) => addSubtask(cardId, title))
          })
          .catch(() => {
            // Fall back to heuristic summary + todos on API failure
            const { summary, todoTitles } = runEmailPipeline(emailThread, emailSkills, rulesRef.current)
            updateCard(cardId, { summary, todosExtracted: true })
            todoTitles.forEach((title) => addSubtask(cardId, title))
          })
      } else {
        // No session (e.g. demo mode) — use heuristic immediately
        const { summary, todoTitles } = runEmailPipeline(emailThread, emailSkills, rulesRef.current)
        updateCard(cardId, { summary, todosExtracted: true })
        todoTitles.forEach((title) => addSubtask(cardId, title))
      }

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
    const emailAgentConfig = agentsStore.getConfig('email')
    if (!emailAgentConfig.enabled) {
      setPollStatus('Email Agent is paused — resume it in Settings → Agents.')
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
      let ingested = 0
      for (const email of fresh) {
        const filterResult = applyEmailFilters(
          email as IncomingEmail,
          emailAgentConfig.filters
        )
        if (filterResult === 'skip') continue
        const priority: Priority | undefined =
          filterResult === 'escalate' || filterResult === 'flag' ? 'high' : undefined
        ingestEmailCard(email as IncomingEmail, priority)
        ingested++
      }
      if (emails.length === 0) {
        setPollStatus('No emails returned — inbox empty, already seen this session, or Gmail not connected.')
      } else if (ingested === 0 && fresh.length === 0) {
        setPollStatus(`All ${emails.length} pulled email(s) are already on the board.`)
      } else if (ingested === 0) {
        setPollStatus(`${fresh.length} new email(s) filtered out by agent rules.`)
      } else {
        const skipped = fresh.length - ingested
        setPollStatus(`Pulled ${ingested} new email(s).${skipped > 0 ? ` ${skipped} filtered by rules.` : ''}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Poll failed'
      setPollStatus(`Pull failed: ${message}`)
      console.error('[Email Agent] Poll failed:', error)
    }
  }, [sessionId, ingestEmailCard, agentsStore])

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

  // Turn a Slack message into a card, then run the Slack triage pipeline.
  const ingestSlackCard = useCallback(
    (msg: IncomingSlackMessage) => {
      const title = msg.text.trim().slice(0, 60) || `Slack from ${msg.from}`
      const cardId = addCard('col-new', {
        title,
        description: msg.text,
        source: 'slack',
        provider: 'slack',
        externalId: msg.messageId,
        client: { name: msg.from },
        sourceUrl: msg.permalink ?? undefined,
      })
      const slackSkills = skillsRef.current.filter((s) => s.category === 'slack' && s.enabled)
      const { summary, todoTitles, skillsApplied } = runSlackPipeline(msg.text, slackSkills)
      updateCard(cardId, { summary, todosExtracted: true, skillsApplied })
      todoTitles.forEach((t) => addSubtask(cardId, t))
      return cardId
    },
    [addCard, updateCard, addSubtask]
  )

  // Poll Slack and ingest messages not already on the board. Inert (empty) when
  // Slack isn't connected — the server returns no messages.
  const pullSlack = useCallback(async () => {
    if (!sessionId) return
    try {
      const msgs = await pollSlackMessages(sessionId)
      const existing = new Set(
        Object.values(boardRef.current.cards).map((c) => c.externalId).filter(Boolean)
      )
      const fresh = msgs.filter((m) => !existing.has(m.messageId))
      fresh.forEach((m) => ingestSlackCard(m))
      if (fresh.length) setPollStatus(`Pulled ${fresh.length} Slack message(s).`)
    } catch (error) {
      setPollStatus(`Slack pull failed: ${error instanceof Error ? error.message : 'error'}`)
    }
  }, [sessionId, ingestSlackCard])

  useEffect(() => {
    if (!sessionId) return
    const initial = window.setTimeout(() => void pullSlack(), 0)
    const timer = window.setInterval(() => void pullSlack(), 30000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [sessionId, pullSlack])

  return (
    <FlagsProvider>
    <div className="app-shell">
      <Sidebar currentView={view} onNavigate={setView} currentUser={currentUser} />
      <main className="main-content">
        {view === 'board' ? (
          <HomePage
            boardStore={boardStore}
            projects={projectsStore.projects}
            approvalsStore={approvalsStore}
            emailGroupsStore={emailGroupsStore}
            currentUser={currentUser}
            users={mergedUsers}
            directoryNeedsReauth={directoryNeedsReauth}
            activeCard={activeCard}
            onOpenCard={openCard}
            onCloseCard={() => setActiveCardId(null)}
            onSimulateEmail={() => setActiveCardId(ingestEmailCard(SAMPLE_EMAIL))}
            onSimulateSlack={() => ingestSlackCard(SAMPLE_SLACK)}
            onPullInbox={pullInbox}
            pollStatus={pollStatus}
            onCreateProject={projectsStore.addProject}
            sessionId={sessionId ?? ''}
            voiceInstructions={voiceInstructions}
          />
        ) : null}
        {view === 'projects' ? (
          <ProjectsPage
            projectsStore={projectsStore}
            boardStore={boardStore}
            onOpenCard={openCard}
          />
        ) : null}
        {view === 'process-manager' ? (
          <ProcessManagerPage />
        ) : null}
        {view === 'settings' ? (
          <SettingsPage
            skillsStore={skillsStore}
            approvalsStore={approvalsStore}
            agentsStore={agentsStore}
            board={boardStore.board}
          />
        ) : null}
      </main>
    </div>
    </FlagsProvider>
  )
}

function AppShell() {
  const { authenticated, sessionId } = useSession()
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)

  useEffect(() => {
    if (!authenticated || !sessionId) { setOnboardingDone(null); return }
    apiFetch(`/api/user-settings?sessionId=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json() as Promise<{ onboardingCompleted: boolean }>)
      .then((data) => setOnboardingDone(data.onboardingCompleted))
      .catch(() => setOnboardingDone(true))
  }, [authenticated, sessionId])

  if (!authenticated) return <LoginPage />

  if (onboardingDone === null) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>
        Loading…
      </div>
    )
  }

  if (!onboardingDone) {
    return <OnboardingPage onComplete={() => setOnboardingDone(true)} />
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
