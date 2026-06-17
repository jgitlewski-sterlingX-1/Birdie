import { useEffect, useMemo, useState } from 'react'
import type { Card, Project, User } from '../types'
import { simulateCreateDraft } from '../gmail'
import { generateDraft } from '../draftApi'
import { useFlags } from '../flags'

interface CardModalProps {
  card: Card
  projects: Project[]
  users: User[]
  subtasks: Card[]
  onClose: () => void
  onUpdateCard: (cardId: string, patch: Partial<Card>) => void
  onAddSubtask: (parentId: string, title: string) => void
  onDelegate: (cardId: string, assigneeId: string, actionItems: string[]) => void
  onCreateProject: (name: string, description?: string) => string
  sessionId: string
  voiceInstructions: string
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
  onDelegate,
  onCreateProject,
  sessionId,
  voiceInstructions,
  onDeleteCard,
  onLogApproval,
}: CardModalProps) {
  const [newTodo, setNewTodo] = useState('')
  const [draft, setDraft] = useState(card.draft ?? '')
  // Delegation form state
  const [delegateTo, setDelegateTo] = useState('')
  const [actionItems, setActionItems] = useState<string[]>([])
  const [actionInput, setActionInput] = useState('')
  // New-project form state
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  // Auto-draft state
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)

  const { has } = useFlags()

  const project = useMemo(() => projects.find((p) => p.id === card.projectId), [projects, card.projectId])
  const assignee = useMemo(() => users.find((u) => u.id === card.assigneeId), [users, card.assigneeId])

  const addActionItem = () => {
    if (!actionInput.trim()) return
    setActionItems((items) => [...items, actionInput.trim()])
    setActionInput('')
  }

  const submitDelegation = () => {
    if (!delegateTo) return
    onDelegate(card.id, delegateTo, actionItems)
    setActionItems([])
    setActionInput('')
  }

  const handleCreateProject = () => {
    const name = newProjectName.trim()
    if (!name) return
    const id = onCreateProject(name)
    onUpdateCard(card.id, { projectId: id })
    setNewProjectName('')
    setShowNewProject(false)
  }

  const runDraft = async () => {
    if (!card.emailThread || card.emailThread.length === 0) return
    setDraftLoading(true)
    setDraftError(null)
    try {
      const text = await generateDraft(sessionId, {
        messages: card.emailThread,
        subject: card.replyMeta?.subject ?? card.title,
        voiceInstructions,
      })
      setDraft(text)
      onUpdateCard(card.id, { draft: text })
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Draft failed')
    } finally {
      setDraftLoading(false)
    }
  }

  // Auto-draft a reply in the user's voice when an email card opens with no draft.
  // The modal is keyed by card id, so this runs once per opened card.
  useEffect(() => {
    if (!has('voice_drafting')) return
    if (card.source !== 'gmail') return
    if (card.draft || !card.emailThread || card.emailThread.length === 0) return
    const t = window.setTimeout(() => void runDraft(), 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
              {card.delegatedAt && assignee ? (
                <span
                  className="badge"
                  style={{ color: '#7c3aed', background: '#f3e8ff', marginTop: 6, display: 'inline-block' }}
                >
                  Delegated → {assignee.name}
                </span>
              ) : null}
              {card.summary ? (
                <p style={{ color: '#475569', marginTop: 6, whiteSpace: 'pre-wrap' }}>{card.summary}</p>
              ) : null}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>Reply composer</h3>
                {has('voice_drafting') ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void runDraft()}
                    disabled={draftLoading}
                  >
                    {draftLoading ? 'Drafting…' : draft ? 'Regenerate in my voice' : 'Draft in my voice'}
                  </button>
                ) : null}
              </div>
              {draftLoading ? (
                <div style={{ fontSize: 12, color: '#64748b' }}>Drafting a reply in your voice…</div>
              ) : null}
              {draftError ? (
                <div style={{ fontSize: 12, color: '#b91c1c' }}>{draftError}</div>
              ) : null}
              <textarea
                rows={6}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={draftLoading ? 'Drafting in your voice…' : 'Write a draft reply...'}
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
          {has('card_delegation') ? (
          <section className="panel" style={{ padding: 10, display: 'grid', gap: 8 }}>
            <h3>Delegate</h3>
            {card.delegatedAt && assignee ? (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 13 }}>
                  Delegated to <strong>{assignee.name}</strong> · keeps showing on your board until the
                  action items are done.
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onUpdateCard(card.id, { assigneeId: undefined, delegatedAt: undefined })}
                >
                  Revoke delegation
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                <label>
                  Assign to another user
                  <select
                    value={delegateTo}
                    onChange={(e) => setDelegateTo(e.target.value)}
                    style={{ width: '100%', marginTop: 4, border: '1px solid #cbd5e1', borderRadius: 6, padding: 6 }}
                  >
                    <option value="">Choose user…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>

                <span style={{ fontWeight: 600, fontSize: 13 }}>Action items</span>
                {actionItems.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#475569' }}>
                    {actionItems.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="modal-subtask-add">
                  <input
                    value={actionInput}
                    onChange={(e) => setActionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addActionItem()
                      }
                    }}
                    placeholder="Add an action item"
                    style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', flex: 1 }}
                  />
                  <button type="button" className="btn btn-ghost" onClick={addActionItem}>
                    Add
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!delegateTo}
                  onClick={submitDelegation}
                >
                  Delegate{actionItems.length ? ` with ${actionItems.length} action item${actionItems.length > 1 ? 's' : ''}` : ''}
                </button>
              </div>
            )}
          </section>
          ) : null}

          <section className="panel" style={{ padding: 10, display: 'grid', gap: 8 }}>
            <h3>Details</h3>
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
            {has('project_create') ? (
            showNewProject ? (
              <div className="modal-subtask-add">
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleCreateProject()
                    }
                  }}
                  placeholder="New project name"
                  autoFocus
                  style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', flex: 1 }}
                />
                <button type="button" className="btn btn-primary" onClick={handleCreateProject}>
                  Create
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowNewProject(false)
                    setNewProjectName('')
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ justifySelf: 'start' }}
                onClick={() => setShowNewProject(true)}
              >
                + New project
              </button>
            )) : null}
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
