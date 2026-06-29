import { useMemo, useState, useEffect } from 'react'
import type { Card, Project, User } from '../types'
import type { useBoard } from '../store'
import type { useApprovals } from '../approvalsStore'
import type { useEmailGroups } from '../emailGroupsStore'
import { USERS } from '../users'
import { ColumnView } from '../components/ColumnView'
import { CardModal } from '../components/CardModal'
import { useFlags } from '../flags'

interface HomePageProps {
  boardStore: ReturnType<typeof useBoard>
  projects: Project[]
  approvalsStore: ReturnType<typeof useApprovals>
  emailGroupsStore: ReturnType<typeof useEmailGroups>
  currentUser: User
  users?: User[]
  directoryNeedsReauth?: boolean
  activeCard: Card | null
  onOpenCard: (id: string) => void
  onCloseCard: () => void
  onSimulateEmail: () => void
  onSimulateSlack: () => void
  onPullInbox: () => void
  pollStatus: string | null
  lastPulled?: Date | null
  nextPull?: Date | null
  onCreateProject: (name: string, description?: string) => string
  sessionId: string
  voiceInstructions: string
}

export function HomePage({
  boardStore,
  projects,
  approvalsStore,
  emailGroupsStore,
  currentUser,
  users: usersProp,
  directoryNeedsReauth = false,
  activeCard,
  onOpenCard,
  onCloseCard,
  onSimulateEmail,
  onSimulateSlack,
  onPullInbox,
  pollStatus,
  lastPulled,
  nextPull,
  onCreateProject,
  sessionId,
  voiceInstructions,
}: HomePageProps) {
  const { board, addCard, updateCard, deleteCard, addSubtask, delegateCard, moveCard } = boardStore
  const { has } = useFlags()

  const users = usersProp ?? USERS

  const projectsById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects]
  )
  const usersById = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, u])),
    [users]
  )

  return (
    <div>
      {directoryNeedsReauth ? (
        <div style={{ margin: '0 0 12px', padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>⚠</span>
          <span>Sign out and back in to load your full org directory — your current session pre-dates that permission.</span>
        </div>
      ) : null}

      <header className="page-header">
        <div>
          <div className="page-title">Board</div>
          <div className="page-subtitle">AI triage workspace</div>
          <InboxStatus lastPulled={lastPulled ?? null} nextPull={nextPull ?? null} message={pollStatus} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={onPullInbox}>
            Pull inbox
          </button>
          <button type="button" className="btn btn-ghost" onClick={onSimulateEmail}>
            Simulate incoming email
          </button>
          {has('slack_integration') ? (
            <button type="button" className="btn btn-ghost" onClick={onSimulateSlack}>
              Simulate Slack message
            </button>
          ) : null}
        </div>
      </header>

      <div className="board-columns">
        {board.columns.map((column) => (
          <ColumnView
            key={column.id}
            title={column.title}
            cardIds={column.cardIds}
            board={board}
            projectsById={projectsById}
            usersById={usersById}
            onOpenCard={onOpenCard}
            onAddCard={() =>
              addCard(column.id, {
                title: 'New card',
                description: 'Describe the work item.',
                source: 'user',
              })
            }
          />
        ))}
      </div>

      {activeCard ? (
        <CardModal
          key={activeCard.id}
          card={activeCard}
          projects={projects}
          users={users}
          subtasks={Object.values(board.cards).filter((c) => c.parentId === activeCard.id)}
          onClose={onCloseCard}
          onUpdateCard={updateCard}
          onAddSubtask={addSubtask}
          onDelegate={delegateCard}
          onMoveCard={moveCard}
          onCreateProject={onCreateProject}
          sessionId={sessionId}
          voiceInstructions={voiceInstructions}
          onDeleteCard={deleteCard}
          emailGroupsStore={emailGroupsStore}
          onLogApproval={(message, externalRef) => {
            approvalsStore.addEntry({
              userId: currentUser.id,
              cardId: activeCard.id,
              cardTitle: activeCard.title,
              source: activeCard.source,
              action: message,
              messagePreview: (activeCard.draft ?? '').slice(0, 120),
              approvedById: currentUser.id,
              approvedByName: currentUser.name,
              externalRef,
            })
          }}
        />
      ) : null}
    </div>
  )
}

function InboxStatus({
  lastPulled,
  nextPull,
  message,
}: {
  lastPulled: Date | null
  nextPull: Date | null
  message: string | null
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  function fmtTime(d: Date) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  function ago(d: Date) {
    const mins = Math.round((now - d.getTime()) / 60_000)
    if (mins < 1) return 'just now'
    if (mins === 1) return '1 min ago'
    return `${mins} min ago`
  }

  function inMin(d: Date) {
    const mins = Math.round((d.getTime() - now) / 60_000)
    if (mins <= 0) return 'now'
    if (mins === 1) return '1 min'
    return `${mins} min`
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 6, fontSize: 11, color: '#64748b', flexWrap: 'wrap' }}>
      {lastPulled ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', flexShrink: 0 }} />
          Last pulled {fmtTime(lastPulled)} ({ago(lastPulled)})
        </span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#94a3b8', display: 'inline-block', flexShrink: 0 }} />
          Not yet pulled
        </span>
      )}
      {nextPull ? (
        <span>Next pull in {inMin(nextPull)} ({fmtTime(nextPull)})</span>
      ) : null}
      {message ? (
        <span style={{ color: '#94a3b8' }}>— {message}</span>
      ) : null}
    </div>
  )
}
