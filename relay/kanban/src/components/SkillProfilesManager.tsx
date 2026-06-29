// src/components/SkillProfilesManager.tsx — admin UI for skill profile pipeline builder

import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../session'
import { BASE_SKILLS } from '../skills'
import type { StageCondition, SkillPipelineStage, SkillProfile } from '../types'
import type { AdminUser } from '../flagsApi'
import {
  assignProfileToUser,
  createSkillProfile,
  deleteSkillProfile,
  listSkillProfiles,
  updateSkillProfile,
  type StageInput,
} from '../skillProfilesApi'

interface Props {
  users: AdminUser[]
}

// Local editing state for one stage (id/position are server-assigned)
interface StageForm {
  name: string
  skillIds: string[]
  condition: StageCondition | null
}

interface ProfileForm {
  name: string
  description: string
  stages: StageForm[]
}

const CLASSIFICATION_VALUES: StageCondition['value'][] = ['ACTION_NEEDED', 'FYI', 'NOISE']

function emptyStage(): StageForm {
  return { name: '', skillIds: [], condition: null }
}

function profileToForm(p: SkillProfile): ProfileForm {
  return {
    name: p.name,
    description: p.description ?? '',
    stages: p.stages.map((s) => ({
      name: s.name,
      skillIds: s.skillIds,
      condition: s.condition,
    })),
  }
}

// ── Stage condition editor ────────────────────────────────────────────────────

function ConditionEditor({
  condition,
  onChange,
}: {
  condition: StageCondition | null
  onChange: (c: StageCondition | null) => void
}) {
  const enabled = condition !== null
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#64748b' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { field: 'classification', operator: 'equals', value: 'ACTION_NEEDED' }
                : null,
            )
          }
        />
        Only run if prior classification…
      </label>
      {enabled && condition ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 20, flexWrap: 'wrap' }}>
          <select
            value={condition.operator}
            onChange={(e) =>
              onChange({ ...condition, operator: e.target.value as StageCondition['operator'] })
            }
            style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '3px 6px', fontSize: 12 }}
          >
            <option value="equals">equals</option>
            <option value="not_equals">does not equal</option>
          </select>
          <select
            value={condition.value}
            onChange={(e) =>
              onChange({ ...condition, value: e.target.value as StageCondition['value'] })
            }
            style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '3px 6px', fontSize: 12 }}
          >
            {CLASSIFICATION_VALUES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  )
}

// ── Single stage editor row ───────────────────────────────────────────────────

function StageEditor({
  stage,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  stage: StageForm
  index: number
  total: number
  onChange: (s: StageForm) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const toggleSkill = (id: string) => {
    const next = stage.skillIds.includes(id)
      ? stage.skillIds.filter((s) => s !== id)
      : [...stage.skillIds, id]
    onChange({ ...stage, skillIds: next })
  }

  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: 10,
        background: '#f8fafc',
        display: 'grid',
        gap: 8,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#1d4ed8',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {index + 1}
        </span>
        <input
          value={stage.name}
          onChange={(e) => onChange({ ...stage, name: e.target.value })}
          placeholder={`Stage ${index + 1} name`}
          style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}
        />
        <button
          type="button"
          title="Move up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, opacity: index === 0 ? 0.3 : 1, padding: '0 2px' }}
        >↑</button>
        <button
          type="button"
          title="Move down"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, opacity: index === total - 1 ? 0.3 : 1, padding: '0 2px' }}
        >↓</button>
        <button
          type="button"
          title="Remove stage"
          onClick={onRemove}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#dc2626', padding: '0 2px' }}
        >✕</button>
      </div>

      {/* Skills */}
      <div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Skills (run in parallel):</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {BASE_SKILLS.map((skill) => (
            <label key={skill.id} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={stage.skillIds.includes(skill.id)}
                onChange={() => toggleSkill(skill.id)}
              />
              {skill.name}
            </label>
          ))}
        </div>
      </div>

      {/* Condition */}
      <ConditionEditor
        condition={stage.condition}
        onChange={(c) => onChange({ ...stage, condition: c })}
      />
    </div>
  )
}

// ── Profile form (create / edit inline) ──────────────────────────────────────

function ProfileFormPanel({
  initial,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial: ProfileForm
  onSave: (f: ProfileForm) => void
  onCancel: () => void
  saving: boolean
  error: string | null
}) {
  const [form, setForm] = useState<ProfileForm>(initial)

  const setStage = (i: number, s: StageForm) =>
    setForm((f) => ({ ...f, stages: f.stages.map((st, idx) => (idx === i ? s : st)) }))

  const removeStage = (i: number) =>
    setForm((f) => ({ ...f, stages: f.stages.filter((_, idx) => idx !== i) }))

  const moveStage = (i: number, dir: -1 | 1) => {
    setForm((f) => {
      const next = [...f.stages]
      const j = i + dir
      if (j < 0 || j >= next.length) return f
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...f, stages: next }
    })
  }

  return (
    <div style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff' }}>
      {error ? <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div> : null}

      <input
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        placeholder="Profile name"
        autoFocus
        style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '7px 10px', fontSize: 14 }}
      />
      <input
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder="Description (optional)"
        style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '7px 10px', fontSize: 13 }}
      />

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#1e40af' }}>
          Pipeline stages — execute top → bottom
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {form.stages.map((stage, i) => (
            <StageEditor
              key={i}
              stage={stage}
              index={i}
              total={form.stages.length}
              onChange={(s) => setStage(i, s)}
              onRemove={() => removeStage(i)}
              onMove={(dir) => moveStage(i, dir)}
            />
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginTop: 6, fontSize: 12 }}
          onClick={() => setForm((f) => ({ ...f, stages: [...f.stages, emptyStage()] }))}
        >
          + Add stage
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || !form.name.trim()}
          onClick={() => onSave(form)}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  )
}

// ── Stages read-only display ──────────────────────────────────────────────────

function StagesPipeline({ stages }: { stages: SkillPipelineStage[] }) {
  if (!stages.length) {
    return <span style={{ fontSize: 12, color: '#94a3b8' }}>No stages</span>
  }
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {stages.map((stage, i) => (
        <div key={stage.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {i > 0 ? <span style={{ color: '#94a3b8', fontSize: 12 }}>→</span> : null}
          <span
            style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              color: '#1d4ed8',
            }}
          >
            {stage.name || `Stage ${i + 1}`}
            {stage.condition ? (
              <span style={{ color: '#6b7280' }}>
                {' '}({stage.condition.operator === 'equals' ? '=' : '≠'} {stage.condition.value})
              </span>
            ) : null}
            <span style={{ color: '#94a3b8' }}> · {stage.skillIds.length} skill{stage.skillIds.length !== 1 ? 's' : ''}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function SkillProfilesManager({ users }: Props) {
  const { sessionId } = useSession()
  const sid = sessionId ?? ''

  const [profiles, setProfiles] = useState<SkillProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const ps = await listSkillProfiles(sid)
      setProfiles(ps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profiles')
    } finally {
      setLoading(false)
    }
  }, [sid])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(t)
  }, [load])

  const toStageInputs = (stages: StageForm[]): StageInput[] =>
    stages.map((s) => ({
      name: s.name.trim() || 'Untitled stage',
      skillIds: s.skillIds,
      condition: s.condition,
    }))

  const handleCreate = async (form: ProfileForm) => {
    setSaving(true)
    setFormError(null)
    try {
      const p = await createSkillProfile(sid, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        stages: toStageInputs(form.stages),
      })
      setProfiles((ps) => [...ps, p])
      setEditingId(null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create profile')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (id: string, form: ProfileForm) => {
    setSaving(true)
    setFormError(null)
    try {
      const p = await updateSkillProfile(sid, id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        stages: toStageInputs(form.stages),
      })
      setProfiles((ps) => ps.map((x) => (x.id === id ? p : x)))
      setEditingId(null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this profile? Users assigned to it will be unassigned.')) return
    try {
      await deleteSkillProfile(sid, id)
      setProfiles((ps) => ps.filter((p) => p.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete profile')
    }
  }

  const handleAssign = async (userId: string, profileId: string | null) => {
    setAssigningId(userId)
    try {
      await assignProfileToUser(sid, userId, profileId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign profile')
    } finally {
      setAssigningId(null)
    }
  }

  if (loading) {
    return <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading…</div>
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error ? <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div> : null}

      {/* Profiles */}
      <section className="panel" style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Skill profiles</h3>
          {editingId !== 'new' ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 12 }}
              onClick={() => { setFormError(null); setEditingId('new') }}
            >
              + New profile
            </button>
          ) : null}
        </div>

        {editingId === 'new' ? (
          <div style={{ marginBottom: 10 }}>
            <ProfileFormPanel
              initial={{ name: '', description: '', stages: [emptyStage()] }}
              onSave={handleCreate}
              onCancel={() => setEditingId(null)}
              saving={saving}
              error={formError}
            />
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 8 }}>
          {profiles.map((profile) => (
            <div key={profile.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, display: 'grid', gap: 8 }}>
              {editingId === profile.id ? (
                <ProfileFormPanel
                  initial={profileToForm(profile)}
                  onSave={(f) => void handleUpdate(profile.id, f)}
                  onCancel={() => setEditingId(null)}
                  saving={saving}
                  error={formError}
                />
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{profile.name}</div>
                      {profile.description ? (
                        <div style={{ fontSize: 12, color: '#64748b' }}>{profile.description}</div>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => { setFormError(null); setEditingId(profile.id) }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ fontSize: 12 }}
                        onClick={() => void handleDelete(profile.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <StagesPipeline stages={profile.stages} />
                </>
              )}
            </div>
          ))}

          {profiles.length === 0 && editingId !== 'new' ? (
            <div style={{ color: '#64748b', fontSize: 13 }}>No profiles yet.</div>
          ) : null}
        </div>
      </section>

      {/* User assignment */}
      {users.length > 0 ? (
        <section className="panel" style={{ padding: 12 }}>
          <h3 style={{ marginBottom: 8 }}>Assign profiles to users</h3>
          <div style={{ display: 'grid', gap: 6 }}>
            {users.map((user) => (
              <div
                key={user.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '8px 12px',
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{user.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{user.email}</div>
                </div>
                <select
                  disabled={assigningId === user.id}
                  defaultValue=""
                  style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '5px 8px', fontSize: 12 }}
                  onChange={(e) => void handleAssign(user.id, e.target.value || null)}
                >
                  <option value="">— None —</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
