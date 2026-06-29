import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../session'
import { apiFetch } from '../apiClient'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DepartmentAgent {
  id: string
  name: string
  tier: 'department'
  model: string
  mandate: string
  tools: string[]
  mcp_servers: string[]
}

interface OrchestratorAgent {
  id: string
  name: string
  tier: 'orchestrator'
  model: string
  mandate: string
  tools: string[]
  delegates_to: string[]
}

type AnyAgent = OrchestratorAgent | DepartmentAgent

interface AgentRegistry {
  orchestrator: OrchestratorAgent
  departments: DepartmentAgent[]
}

interface SavedPipeline {
  featureKey: string
  name: string
  agentIds: string[]
}

// ── Static app features ───────────────────────────────────────────────────────
// These are the configurable workflow slots in the application.

interface AppFeature {
  key: string
  label: string
  description: string
  defaultAgentIds: string[]
}

const APP_FEATURES: AppFeature[] = [
  {
    key: 'email_reply_draft',
    label: 'Draft Email Reply',
    description: 'Compose a contextual reply to an email thread.',
    defaultAgentIds: ['receptionist', 'communications_manager'],
  },
  {
    key: 'inbox_triage',
    label: 'Triage Inbox',
    description: 'Classify, summarize, and label incoming emails.',
    defaultAgentIds: ['receptionist'],
  },
  {
    key: 'meeting_schedule',
    label: 'Schedule Meeting',
    description: 'Find available times and create a calendar event.',
    defaultAgentIds: ['calendar_manager'],
  },
  {
    key: 'task_create',
    label: 'Create Task from Card',
    description: 'Turn a card into a tracked task in ClickUp.',
    defaultAgentIds: ['operations_manager'],
  },
  {
    key: 'financial_summary',
    label: 'Financial Summary',
    description: 'Pull and narrate financial data from BigQuery.',
    defaultAgentIds: ['finance_manager'],
  },
  {
    key: 'full_outreach',
    label: 'Full Outreach Workflow',
    description: 'Read context, then draft and send an outbound message.',
    defaultAgentIds: ['receptionist', 'communications_manager'],
  },
]

// ── Visual constants ──────────────────────────────────────────────────────────

const MODEL_LABEL: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-sonnet-4-6': 'Sonnet 4.6',
}

const TIER_COLOR: Record<string, string> = {
  orchestrator: '#6366f1',
  department: '#0ea5e9',
}

const MCP_COLOR: Record<string, string> = {
  slack: '#4a154b',
  gmail: '#d93025',
  gcal: '#1a73e8',
  clickup: '#7b68ee',
  bigquery: '#4285f4',
}

// ── Small shared components ───────────────────────────────────────────────────

function Chip({ label, color }: { label: string; color?: string }) {
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      padding: '1px 6px',
      borderRadius: 99,
      background: color ? color + '18' : '#f1f5f9',
      color: color ?? '#475569',
      border: `1px solid ${color ? color + '33' : '#e2e8f0'}`,
      letterSpacing: '0.02em',
      textTransform: 'uppercase',
    }}>
      {label}
    </span>
  )
}

// ── Agent library card (left panel) ──────────────────────────────────────────

function AgentCard({
  agent,
  isInPipeline,
  isActiveFeature,
  onAdd,
}: {
  agent: AnyAgent
  isInPipeline: boolean
  isActiveFeature: boolean
  onAdd: () => void
}) {
  const accent = TIER_COLOR[agent.tier]
  const servers = 'mcp_servers' in agent ? agent.mcp_servers : []

  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 8,
      border: `1.5px solid ${isInPipeline && isActiveFeature ? accent : 'var(--border)'}`,
      background: isInPipeline && isActiveFeature ? accent + '08' : 'var(--surface)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      transition: 'border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1, color: 'var(--text)' }}>{agent.name}</span>
        <Chip label={MODEL_LABEL[agent.model] ?? agent.model} />
      </div>

      <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
        {agent.mandate.length > 90 ? agent.mandate.slice(0, 87) + '…' : agent.mandate}
      </p>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {servers.map((s) => (
          <Chip key={s} label={s} color={MCP_COLOR[s]} />
        ))}
        {agent.tools.slice(0, 2).map((t) => (
          <Chip key={t} label={t.replace(/_/g, ' ')} />
        ))}
        {agent.tools.length > 2 && <Chip label={`+${agent.tools.length - 2} more`} />}
      </div>

      {isActiveFeature && (
        <button
          type="button"
          onClick={onAdd}
          disabled={isInPipeline}
          style={{
            marginTop: 2,
            padding: '5px 10px',
            borderRadius: 5,
            border: 'none',
            background: isInPipeline ? '#f1f5f9' : accent,
            color: isInPipeline ? '#94a3b8' : 'white',
            fontSize: 11,
            fontWeight: 700,
            cursor: isInPipeline ? 'default' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {isInPipeline ? '✓ In pipeline' : '+ Add to pipeline'}
        </button>
      )}
    </div>
  )
}

// ── Pipeline step row ─────────────────────────────────────────────────────────

function PipelineStep({
  position,
  total,
  agent,
  onUp,
  onDown,
  onRemove,
}: {
  position: number
  total: number
  agent: AnyAgent | undefined
  onUp: () => void
  onDown: () => void
  onRemove: () => void
}) {
  const accent = agent ? TIER_COLOR[agent.tier] : '#94a3b8'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '7px 10px',
      borderRadius: 6,
      background: '#f8fafc',
      border: '1px solid var(--border)',
    }}>
      <span style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: accent,
        color: 'white',
        fontSize: 10,
        fontWeight: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {position + 1}
      </span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        {agent?.name ?? <em style={{ color: 'var(--muted)' }}>Unknown agent</em>}
      </span>
      {agent && <Chip label={MODEL_LABEL[agent.model] ?? agent.model} />}
      <div style={{ display: 'flex', gap: 2 }}>
        <button type="button" onClick={onUp} disabled={position === 0}
          style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'white', cursor: position === 0 ? 'default' : 'pointer', opacity: position === 0 ? 0.3 : 1, fontSize: 11 }}>
          ↑
        </button>
        <button type="button" onClick={onDown} disabled={position === total - 1}
          style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'white', cursor: position === total - 1 ? 'default' : 'pointer', opacity: position === total - 1 ? 0.3 : 1, fontSize: 11 }}>
          ↓
        </button>
        <button type="button" onClick={onRemove}
          style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #fecaca', background: '#fef2f2', color: '#ef4444', cursor: 'pointer', fontSize: 11 }}>
          ✕
        </button>
      </div>
    </div>
  )
}

// ── Feature pipeline panel ────────────────────────────────────────────────────

function FeaturePanel({
  feature,
  agentIds,
  allAgents,
  isSelected,
  isDirty,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
  onSave,
  saving,
}: {
  feature: AppFeature
  agentIds: string[]
  allAgents: AnyAgent[]
  isSelected: boolean
  isDirty: boolean
  onSelect: () => void
  onMoveUp: (i: number) => void
  onMoveDown: (i: number) => void
  onRemove: (i: number) => void
  onSave: () => void
  saving: boolean
}) {
  const agentById = Object.fromEntries(allAgents.map((a) => [a.id, a]))

  return (
    <div
      style={{
        borderRadius: 10,
        border: `2px solid ${isSelected ? '#6366f1' : 'var(--border)'}`,
        background: 'var(--surface)',
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onSelect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '12px 16px',
          background: isSelected ? '#6366f108' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{feature.label}</span>
            {isDirty && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: '#fef3c7', color: '#d97706', border: '1px solid #fde68a' }}>
                unsaved
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{feature.description}</div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {agentIds.length === 0 ? 'No agents' : `${agentIds.length} agent${agentIds.length > 1 ? 's' : ''}`}
          {isSelected ? ' ▲' : ' ▼'}
        </span>
      </button>

      {/* Pipeline editor (expanded when selected) */}
      {isSelected && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {agentIds.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>
              No agents in pipeline — click <strong>+ Add to pipeline</strong> on an agent card to the left.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {agentIds.map((id, i) => (
                <PipelineStep
                  key={id + i}
                  position={i}
                  total={agentIds.length}
                  agent={agentById[id]}
                  onUp={() => onMoveUp(i)}
                  onDown={() => onMoveDown(i)}
                  onRemove={() => onRemove(i)}
                />
              ))}
            </div>
          )}

          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !isDirty}
              style={{
                padding: '7px 18px',
                borderRadius: 6,
                border: 'none',
                background: isDirty ? '#6366f1' : '#e2e8f0',
                color: isDirty ? 'white' : '#94a3b8',
                fontWeight: 700,
                fontSize: 13,
                cursor: isDirty ? 'pointer' : 'default',
                transition: 'background 0.15s',
              }}
            >
              {saving ? 'Saving…' : 'Save pipeline'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AgentLibraryPage() {
  const { sessionId } = useSession()

  const [allAgents, setAllAgents] = useState<AnyAgent[]>([])
  const [pipelines, setPipelines] = useState<Record<string, string[]>>({})
  const [savedPipelines, setSavedPipelines] = useState<Record<string, string[]>>({})
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Load agents and saved pipelines
  useEffect(() => {
    const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
    Promise.all([
      apiFetch(`/api/agents${qs}`).then((r) => r.json()),
      apiFetch(`/api/agent-pipelines${qs}`).then((r) => r.json()),
    ]).then(([registry, pipelineData]: [AgentRegistry, { pipelines: SavedPipeline[] }]) => {
      setAllAgents([registry.orchestrator, ...registry.departments])
      // Build initial pipeline state: saved if exists, else feature defaults
      const initial: Record<string, string[]> = {}
      for (const f of APP_FEATURES) {
        const saved = pipelineData.pipelines.find((p) => p.featureKey === f.key)
        initial[f.key] = saved ? saved.agentIds : [...f.defaultAgentIds]
      }
      setPipelines(initial)
      setSavedPipelines({ ...initial })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [sessionId])

  const addAgent = useCallback((featureKey: string, agentId: string) => {
    setPipelines((prev) => {
      const current = prev[featureKey] ?? []
      if (current.includes(agentId)) return prev
      return { ...prev, [featureKey]: [...current, agentId] }
    })
  }, [])

  const moveStep = useCallback((featureKey: string, fromIdx: number, toIdx: number) => {
    setPipelines((prev) => {
      const steps = [...(prev[featureKey] ?? [])]
      const [item] = steps.splice(fromIdx, 1)
      steps.splice(toIdx, 0, item)
      return { ...prev, [featureKey]: steps }
    })
  }, [])

  const removeStep = useCallback((featureKey: string, idx: number) => {
    setPipelines((prev) => {
      const steps = [...(prev[featureKey] ?? [])]
      steps.splice(idx, 1)
      return { ...prev, [featureKey]: steps }
    })
  }, [])

  const savePipeline = useCallback(async (featureKey: string) => {
    if (!sessionId) return
    const feature = APP_FEATURES.find((f) => f.key === featureKey)
    if (!feature) return
    setSaving(featureKey)
    try {
      await apiFetch(`/api/agent-pipelines/${encodeURIComponent(featureKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, name: feature.label, agentIds: pipelines[featureKey] ?? [] }),
      })
      setSavedPipelines((prev) => ({ ...prev, [featureKey]: [...(pipelines[featureKey] ?? [])] }))
    } catch {
      // leave dirty state so user can retry
    } finally {
      setSaving(null)
    }
  }, [sessionId, pipelines])

  const isDirty = (featureKey: string) => {
    const current = pipelines[featureKey] ?? []
    const saved = savedPipelines[featureKey] ?? []
    return current.length !== saved.length || current.some((id, i) => id !== saved[i])
  }

  if (loading) {
    return <div style={{ padding: 32, color: 'var(--muted)' }}>Loading agent library…</div>
  }

  const activePipeline = selectedFeature ? (pipelines[selectedFeature] ?? []) : []

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Left: Agent Library */}
      <aside style={{
        width: 280,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 16px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Agent Library</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {selectedFeature
              ? `Click an agent to add it to "${APP_FEATURES.find((f) => f.key === selectedFeature)?.label}"`
              : 'Select a feature on the right to configure its pipeline'}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {allAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isInPipeline={!!selectedFeature && activePipeline.includes(agent.id)}
              isActiveFeature={!!selectedFeature}
              onAdd={() => selectedFeature && addAgent(selectedFeature, agent.id)}
            />
          ))}
        </div>
      </aside>

      {/* Right: Feature Pipelines */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '18px 24px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Feature Pipelines</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Configure which agents run — and in what order — for each app feature.
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {APP_FEATURES.map((feature) => (
            <FeaturePanel
              key={feature.key}
              feature={feature}
              agentIds={pipelines[feature.key] ?? []}
              allAgents={allAgents}
              isSelected={selectedFeature === feature.key}
              isDirty={isDirty(feature.key)}
              onSelect={() => setSelectedFeature((prev) => prev === feature.key ? null : feature.key)}
              onMoveUp={(i) => moveStep(feature.key, i, i - 1)}
              onMoveDown={(i) => moveStep(feature.key, i, i + 1)}
              onRemove={(i) => removeStep(feature.key, i)}
              onSave={() => void savePipeline(feature.key)}
              saving={saving === feature.key}
            />
          ))}
        </div>
      </main>
    </div>
  )
}
