import { SOURCES } from '../sources'
import { PRIORITIES } from '../priorities'
import type { Card, Project, User } from '../types'

interface CardItemProps {
  card: Card
  assignee?: User
  project?: Project
  subtaskCount: number
  onOpen: () => void
}

export function CardItem({ card, assignee, project, subtaskCount, onOpen }: CardItemProps) {
  const source = SOURCES[card.source]

  return (
    <button
      type="button"
      onClick={onOpen}
      className="panel"
      style={{
        display: 'grid',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        padding: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="badge" style={{ color: source.color, background: source.bg }}>
          {source.label}
        </span>
        {card.priority ? (
          <span
            className="badge"
            style={{
              color: PRIORITIES[card.priority].color,
              background: PRIORITIES[card.priority].bg,
            }}
          >
            {PRIORITIES[card.priority].label}
          </span>
        ) : null}
      </div>

      <div style={{ fontWeight: 600 }}>{card.title}</div>

      {card.client ? (
        <div style={{ color: '#64748b', fontSize: 12 }}>
          {card.client.name}
          {card.client.company ? ` - ${card.client.company}` : ''}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {project ? (
            <span className="badge" style={{ background: '#eef2ff', color: project.color }}>
              {project.name}
            </span>
          ) : null}
          {subtaskCount > 0 ? <span style={{ color: '#64748b', fontSize: 12 }}>⊟ {subtaskCount}</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {card.delegatedAt && assignee ? (
            <span className="badge" style={{ color: '#7c3aed', background: '#f3e8ff' }}>
              Delegated
            </span>
          ) : null}
          {assignee ? (
            <span className="avatar" style={{ background: assignee.avatarColor }}>
              {assignee.name.slice(0, 1).toUpperCase()}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  )
}
