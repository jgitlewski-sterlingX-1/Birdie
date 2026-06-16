import type { Board, Project, User } from '../types'
import { CardItem } from './CardItem'

interface ColumnViewProps {
  title: string
  cardIds: string[]
  board: Board
  projectsById: Record<string, Project>
  usersById: Record<string, User>
  onOpenCard: (id: string) => void
  onAddCard: () => void
}

export function ColumnView({
  title,
  cardIds,
  board,
  projectsById,
  usersById,
  onOpenCard,
  onAddCard,
}: ColumnViewProps) {
  return (
    <section className="panel column-panel">
      <div className="column-header">
        <strong>{title}</strong>
        <button type="button" className="btn btn-ghost" onClick={onAddCard}>
          + Add
        </button>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {cardIds.map((cardId) => {
          const card = board.cards[cardId]
          if (!card || card.parentId) return null
          const subtaskCount = Object.values(board.cards).filter((c) => c.parentId === card.id).length
          return (
            <CardItem
              key={card.id}
              card={card}
              assignee={card.assigneeId ? usersById[card.assigneeId] : undefined}
              project={card.projectId ? projectsById[card.projectId] : undefined}
              subtaskCount={subtaskCount}
              onOpen={() => onOpenCard(card.id)}
            />
          )
        })}
      </div>
    </section>
  )
}
