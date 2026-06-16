import { useMemo, useState } from 'react'
import type { Card, Project, User } from '../types'
import { simulateCreateDraft } from '../gmail'

interface CardModalProps {
  card: Card
  projects: Project[]
  users: User[]
  subtasks: Card[]
  onClose: () => void
  onUpdateCard: (cardId: string, patch: Partial<Card>) => void
  onAddSubtask: (parentId: string, title: string) => void
  onDeleteCard: (cardId: string) => void
  onLogApproval: (message: string, externalRef?: string) => void
}

export function CardModal({
  card,
  projects,
  users,
  subtasks,
  onClose,
  onUpdateCard,
  onAddSubtask,
  onDeleteCard,
  onLogApproval,
}: CardModalProps) {
  const [newTodo, setNewTodo] = useState('')
  const [draft, setDraft] = useState(card.draft ?? '')

  const project = useMemo(() => projects.find((p) => p.id === card.projectId), [projects, card.projectId])

  const approveGmailDraft = () => {
    if (!draft.trim()) return
    const meta = card.replyMeta
    if (!meta) {
      onLogApproval('Draft approved in prototype mode (no replyMeta attached).')
      onUpdateCard(card.id, { draft, draftStatus: 'draft-saved' })
      return
    }
    const res = simulateCreateDraft({
      to: meta.to,
      subject: meta.subject,
      body: draft,
      threadId: meta.threadId,
    })
    onUpdateCard(card.id, { draft, draftStatus: 'draft-saved' })
    onLogApproval(`Created Gmail draft for ${meta.to}`, res.draftId)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="modal-overlay"
    >
      <div
        className="panel modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ overflow: 'auto' }}
      >
        <div className="modal-main">
          <div className="modal-top">
            <div>
              <h2 style={{ fontSize: 20 }}>{card.title}</h2>
              {card.summary ? <p style={{ color: '#475569', marginTop: 6 }}>{card.summary}</p> : null}
            </div>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Description</span>
            <textarea
              rows={4}
              value={card.description ?? ''}
              onChange={(e) => onUpdateCard(card.id, { description: e.target.value })}
              style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 8 }}
            />
          </label>

          <section className="panel" style={{ padding: 10 }}>
            <h3 style={{ marginBottom: 8 }}>Subtasks</h3>
            <div style={{ display: 'grid', gap: 6 }}>
              {subtasks.map((todo) => (
                <label key={todo.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={(e) => onUpdateCard(todo.id, { completed: e.target.checked })}
                  />
                  <input
                    value={todo.title}
                    onChange={(e) => onUpdateCard(todo.id, { title: e.target.value })}
                    style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 6px', flex: 1 }}
                  />
                </label>
              ))}
            </div>
            <div className="modal-subtask-add">
              <input
                value={newTodo}
                onChange={(e) => setNewTodo(e.target.value)}
                placeholder="Add subtask"
                style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!newTodo.trim()) return
                  onAddSubtask(card.id, newTodo.trim())
                  setNewTodo('')
                }}
              >
                Add
              </button>
            </div>
          </section>

          {card.source === 'gmail' ? (
            <section className="panel" style={{ padding: 10, display: 'grid', gap: 8 }}>
              <h3>Reply composer</h3>
              <textarea
                rows={6}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a draft reply..."
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 8 }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-primary" onClick={approveGmailDraft}>
                  Approve draft
                </button>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="modal-aside">
          <section className="panel" style={{ padding: 10, display: 'grid', gap: 8 }}>
            <h3>Details</h3>
            <label>
              Assignee
              <select
                value={card.assigneeId ?? ''}
                onChange={(e) => onUpdateCard(card.id, { assigneeId: e.target.value || undefined })}
                style={{ width: '100%', marginTop: 4, border: '1px solid #cbd5e1', borderRadius: 6, padding: 6 }}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                value={card.projectId ?? ''}
                onChange={(e) => onUpdateCard(card.id, { projectId: e.target.value || undefined })}
                style={{ width: '100%', marginTop: 4, border: '1px solid #cbd5e1', borderRadius: 6, padding: 6 }}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {project ? `Project color: ${project.color}` : 'No project selected'}
            </div>
          </section>

          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              onDeleteCard(card.id)
              onClose()
            }}
          >
            Delete card
          </button>
        </aside>
      </div>
    </div>
  )
}
