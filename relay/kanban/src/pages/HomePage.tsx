import { useMemo } from 'react'
import type { Card, Project, User } from '../types'
import type { useBoard } from '../store'
import type { useApprovals } from '../approvalsStore'
import { USERS } from '../users'
import { ColumnView } from '../components/ColumnView'
import { CardModal } from '../components/CardModal'

interface HomePageProps {
  boardStore: ReturnType<typeof useBoard>
  projects: Project[]
  approvalsStore: ReturnType<typeof useApprovals>
  currentUser: User
  activeCard: Card | null
  onOpenCard: (id: string) => void
  onCloseCard: () => void
  onSimulateEmail: () => void
  onPullInbox: () => void
  pollStatus: string | null
  onCreateProject: (name: string, description?: string) => string
  sessionId: string
  voiceInstructions: string
}

export function HomePage({
  boardStore,
  projects,
  approvalsStore,
  currentUser,
  activeCard,
  onOpenCard,
  onCloseCard,
  onSimulateEmail,
  onPullInbox,
  pollStatus,
  onCreateProject,
  sessionId,
  voiceInstructions,
}: HomePageProps) {
  const { board, addCard, updateCard, deleteCard, addSubtask, delegateCard } = boardStore

  const projectsById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects]
  )
  const usersById = useMemo(
    () => Object.fromEntries(USERS.map((u) => [u.id, u])),
    []
  )

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title">Board</div>
          <div className="page-subtitle">AI triage workspace</div>
          {pollStatus ? (
            <div className="page-subtitle" style={{ color: '#64748b', marginTop: 4 }}>
              {pollStatus}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={onPullInbox}>
            Pull inbox
          </button>
          <button type="button" className="btn btn-ghost" onClick={onSimulateEmail}>
            Simulate incoming email
          </button>
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
          users={USERS}
          subtasks={Object.values(board.cards).filter((c) => c.parentId === activeCard.id)}
          onClose={onCloseCard}
          onUpdateCard={updateCard}
          onAddSubtask={addSubtask}
          onDelegate={delegateCard}
          onCreateProject={onCreateProject}
          sessionId={sessionId}
          voiceInstructions={voiceInstructions}
          onDeleteCard={deleteCard}
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
