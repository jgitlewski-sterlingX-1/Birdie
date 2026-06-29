import { useEffect, useMemo, useState } from 'react'
import type { Card, Project, User, RuleConditionField } from '../types'
import { simulateCreateDraft } from '../gmail'
import { generateDraft } from '../draftApi'
import { useFlags } from '../flags'
import type { useEmailGroups } from '../emailGroupsStore'
import { GROUP_COLORS } from '../emailGroupsStore'

// Parse "Display Name <email@addr>" or bare "email@addr"
function parseEmailHeader(raw: string): { email: string; displayName?: string } {
  const match = raw.match(/^(.*?)\s*<([^>]+)>\s*$/)
  if (match) {
    const name = match[1].trim().replace(/^["']|["']$/g, '')
    return { email: match[2].trim().toLowerCase(), displayName: name || undefined }
  }
  return { email: raw.trim().toLowerCase() }
}

// Collect all unique addresses from a gmail card's thread + replyMeta
function extractParticipants(card: Card) {
  const seen = new Set<string>()
  const result: Array<{ email: string; displayName?: string }> = []
  const add = (raw: string) => {
    if (!raw) return
    const p = parseEmailHeader(raw)
    if (!seen.has(p.email)) { seen.add(p.email); result.push(p) }
  }
  card.emailThread?.forEach((msg) => add(msg.from))
  if (card.replyMeta?.to) add(card.replyMeta.to)
  return result
}

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
  emailGroupsStore?: ReturnType<typeof useEmailGroups>
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
  emailGroupsStore,
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
  // Email group creation form state
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupColor, setNewGroupColor] = useState(GROUP_COLORS[0])
  // Email action selection (gmail cards only)
  type EmailAction = 'delegate' | 'draft' | 'ignore' | null
  const [emailAction, setEmailAction] = useState<EmailAction>(null)
  // Ignore rule builder state
  const [ruleField, setRuleField] = useState<RuleConditionField>('from')
  const [ruleOperator, setRuleOperator] = useState<'contains' | 'equals'>('contains')
  const [ruleValue, setRuleValue] = useState('')
  const [ruleNote, setRuleNote] = useState('')
  const [showRuleBuilder, setShowRuleBuilder] = useState(false)

  const participants = useMemo(() => (card.source === 'gmail' ? extractParticipants(card) : []), [card])

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

  const handleCreateGroup = () => {
    const name = newGroupName.trim()
    if (!name || !emailGroupsStore) return
    emailGroupsStore.addGroup(name, newGroupColor)
    setNewGroupName('')
    setNewGroupColor(GROUP_COLORS[0])
    setShowNewGroup(false)
  }

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
              {card.summary === 'Analyzing thread…' ? (
                <p style={{ color: '#94a3b8', marginTop: 6, fontSize: 13, fontStyle: 'italic' }}>
                  Analyzing thread…
                </p>
              ) : card.summary ? (
                <p style={{ color: '#475569', marginTop: 6, whiteSpace: 'pre-wrap' }}>{card.summary}</p>
              ) : null}
            </div>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>

          {card.source === 'gmail' ? (
            <section style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={`btn ${emailAction === 'delegate' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setEmailAction(emailAction === 'delegate' ? null : 'delegate')}
                >
                  Delegate
                </button>
                <button
                  type="button"
                  className={`btn ${emailAction === 'draft' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setEmailAction(emailAction === 'draft' ? null : 'draft')}
                >
                  Write Draft
                </button>
                <button
                  type="button"
                  className={`btn ${emailAction === 'ignore' ? 'btn-primary' : 'btn-ghost'}`}
                  style={emailAction === 'ignore' ? {} : { color: '#b91c1c' }}
                  onClick={() => {
                    setEmailAction(emailAction === 'ignore' ? null : 'ignore')
                    setShowRuleBuilder(false)
                  }}
                >
                  Ignore
                </button>
              </div>

              {emailAction === 'ignore' ? (
                <div
                  className="panel"
                  style={{ padding: 12, display: 'grid', gap: 10, background: '#fff7f7', borderColor: '#fecaca' }}
                >
                  <div style={{ fontSize: 13, color: '#7f1d1d', fontWeight: 500 }}>
                    Ignore this email
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        onUpdateCard(card.id, { completed: true })
                        onClose()
                      }}
                    >
                      Just Ignore
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => setShowRuleBuilder((v) => !v)}
                    >
                      {showRuleBuilder ? 'Hide rule builder' : '+ Add ignore rule'}
                    </button>
                  </div>

                  {showRuleBuilder ? (
                    <div style={{ display: 'grid', gap: 8, borderTop: '1px solid #fecaca', paddingTop: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                        Auto-ignore future emails matching this rule:
                      </span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <select
                          value={ruleField}
                          onChange={(e) => setRuleField(e.target.value as RuleConditionField)}
                          style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 6px', fontSize: 12 }}
                        >
                          <option value="from">From</option>
                          <option value="domain">Domain</option>
                          <option value="subject">Subject</option>
                        </select>
                        <select
                          value={ruleOperator}
                          onChange={(e) => setRuleOperator(e.target.value as 'contains' | 'equals')}
                          style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 6px', fontSize: 12 }}
                        >
                          <option value="contains">contains</option>
                          <option value="equals">equals</option>
                        </select>
                        <input
                          value={ruleValue}
                          onChange={(e) => setRuleValue(e.target.value)}
                          placeholder="Value…"
                          style={{
                            border: '1px solid #cbd5e1',
                            borderRadius: 6,
                            padding: '4px 6px',
                            fontSize: 12,
                            flex: 1,
                            minWidth: 120,
                          }}
                        />
                      </div>
                      <input
                        value={ruleNote}
                        onChange={(e) => setRuleNote(e.target.value)}
                        placeholder="Note (optional)"
                        style={{
                          border: '1px solid #cbd5e1',
                          borderRadius: 6,
                          padding: '4px 6px',
                          fontSize: 12,
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: 12, justifySelf: 'start' }}
                        disabled={!ruleValue.trim() || !emailGroupsStore}
                        onClick={() => {
                          if (!ruleValue.trim() || !emailGroupsStore) return
                          emailGroupsStore.addRule(
                            { field: ruleField, operator: ruleOperator, value: ruleValue.trim() },
                            ruleNote.trim() || undefined
                          )
                          onUpdateCard(card.id, { completed: true })
                          onClose()
                        }}
                      >
                        Save Rule & Ignore
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {card.source === 'gmail' && card.emailThread && card.emailThread.length > 0 ? (
            <section style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 600 }}>Email thread</span>
              <div style={{ display: 'grid', gap: 10 }}>
                {card.emailThread.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{
                      background: '#f8fafc',
                      borderBottom: '1px solid #e2e8f0',
                      padding: '6px 12px',
                      display: 'flex',
                      gap: 12,
                      alignItems: 'baseline',
                      flexWrap: 'wrap',
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{msg.from}</span>
                      {msg.date ? (
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                          {new Date(msg.date).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', year: 'numeric',
                            hour: 'numeric', minute: '2-digit',
                          })}
                        </span>
                      ) : null}
                    </div>
                    <div style={{
                      padding: '10px 12px',
                      fontSize: 13,
                      color: '#334155',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.6,
                      maxHeight: 320,
                      overflowY: 'auto',
                    }}>
                      {msg.body}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 600 }}>Description</span>
              <textarea
                rows={4}
                value={card.description ?? ''}
                onChange={(e) => onUpdateCard(card.id, { description: e.target.value })}
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: 8 }}
              />
            </label>
          )}

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

          {card.source === 'gmail' && (emailAction === 'draft' || !!card.draft) ? (
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
          {has('card_delegation') && (card.source !== 'gmail' || emailAction === 'delegate' || !!card.delegatedAt) ? (
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

          {card.source === 'gmail' && emailGroupsStore && participants.length > 0 ? (
            <section className="panel" style={{ padding: 10, display: 'grid', gap: 10 }}>
              <h3>Participants</h3>
              {participants.map(({ email, displayName }) => {
                const cls = emailGroupsStore.classifications[email]
                const group = cls?.groupId
                  ? emailGroupsStore.groups.find((g) => g.id === cls.groupId)
                  : null
                return (
                  <div key={email} style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontSize: 12, color: '#1e293b', lineHeight: 1.4 }}>
                      {displayName ? (
                        <>
                          <span style={{ fontWeight: 500 }}>{displayName}</span>{' '}
                          <span style={{ color: '#94a3b8' }}>&lt;{email}&gt;</span>
                        </>
                      ) : (
                        <span>{email}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {group ? (
                        <span
                          style={{
                            background: `${group.color}22`,
                            color: group.color,
                            border: `1px solid ${group.color}55`,
                            borderRadius: 4,
                            padding: '1px 7px',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {group.name}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>Unclassified</span>
                      )}
                      <select
                        value={cls?.groupId ?? ''}
                        onChange={(e) => {
                          const val = e.target.value
                          if (val === '__new__') {
                            setShowNewGroup(true)
                            return
                          }
                          emailGroupsStore.classify(email, displayName, val || null)
                        }}
                        style={{
                          fontSize: 11,
                          border: '1px solid #cbd5e1',
                          borderRadius: 4,
                          padding: '2px 4px',
                          background: '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="">Unclassified</option>
                        {emailGroupsStore.groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                        <option disabled>──────</option>
                        <option value="__new__">+ New group…</option>
                      </select>
                    </div>
                  </div>
                )
              })}

              {showNewGroup ? (
                <div
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: 10,
                    display: 'grid',
                    gap: 8,
                    background: '#f8fafc',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600 }}>New group</span>
                  <input
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleCreateGroup() }
                    }}
                    placeholder="Group name (e.g. Clients)"
                    autoFocus
                    style={{
                      border: '1px solid #cbd5e1',
                      borderRadius: 6,
                      padding: '4px 6px',
                      fontSize: 12,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {GROUP_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewGroupColor(c)}
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          background: c,
                          border: newGroupColor === c ? '2px solid #1e293b' : '2px solid transparent',
                          outline: newGroupColor === c ? `2px solid ${c}` : 'none',
                          outlineOffset: 1,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                        aria-label={`Color ${c}`}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={handleCreateGroup}
                      disabled={!newGroupName.trim()}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => {
                        setShowNewGroup(false)
                        setNewGroupName('')
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ justifySelf: 'start', fontSize: 12 }}
                  onClick={() => setShowNewGroup(true)}
                >
                  + New group
                </button>
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
