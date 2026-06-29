import { useEffect, useState } from 'react'
import { useSession } from '../session'
import { apiFetch } from '../apiClient'

interface DepartmentAgent {
  id: string
  name: string
  tier: 'department'
  model: string
  mandate: string
  tools: string[]
  mcp_servers: string[]
  contract_file: string
}

interface OrchestratorAgent {
  id: string
  name: string
  tier: 'orchestrator'
  model: string
  mandate: string
  tools: string[]
  delegates_to: string[]
  contract_file: string
}

interface AgentRegistry {
  orchestrator: OrchestratorAgent
  departments: DepartmentAgent[]
}

const MODEL_LABEL: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
}

const TIER_COLOR: Record<string, string> = {
  orchestrator: '#6366f1',
  department: '#0ea5e9',
}

const MCP_BADGE: Record<string, { label: string; color: string }> = {
  slack:    { label: 'Slack',    color: '#4a154b' },
  gmail:    { label: 'Gmail',    color: '#d93025' },
  gcal:     { label: 'GCal',    color: '#1a73e8' },
  clickup:  { label: 'ClickUp', color: '#7b68ee' },
  bigquery: { label: 'BigQuery',color: '#4285f4' },
}

function ModelChip({ model }: { model: string }) {
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 7px',
      borderRadius: 99,
      background: '#f1f5f9',
      color: '#475569',
      letterSpacing: '0.01em',
    }}>
      {MODEL_LABEL[model] ?? model}
    </span>
  )
}

function McpBadge({ server }: { server: string }) {
  const meta = MCP_BADGE[server]
  if (!meta) return null
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 4,
      background: meta.color + '18',
      color: meta.color,
      border: `1px solid ${meta.color}33`,
    }}>
      {meta.label}
    </span>
  )
}

function AgentCard({
  agent,
  selected,
  onClick,
}: {
  agent: OrchestratorAgent | DepartmentAgent
  selected: boolean
  onClick: () => void
}) {
  const accentColor = TIER_COLOR[agent.tier]
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '14px 16px',
        borderRadius: 10,
        border: selected ? `2px solid ${accentColor}` : '2px solid var(--border)',
        background: selected ? accentColor + '0a' : 'var(--surface)',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: selected ? `0 0 0 3px ${accentColor}22` : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: accentColor,
          flexShrink: 0,
        }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', flex: 1 }}>
          {agent.name}
        </span>
        <ModelChip model={agent.model} />
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
        {agent.mandate}
      </p>
      {'mcp_servers' in agent && agent.mcp_servers.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {agent.mcp_servers.map((s) => <McpBadge key={s} server={s} />)}
        </div>
      )}
    </button>
  )
}

function DetailPanel({ agent }: { agent: OrchestratorAgent | DepartmentAgent }) {
  const accentColor = TIER_COLOR[agent.tier]
  return (
    <div style={{
      padding: '20px 24px',
      borderRadius: 12,
      border: '1px solid var(--border)',
      background: 'var(--surface)',
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: accentColor }} />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{agent.name}</h2>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <ModelChip model={agent.model} />
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 99,
            background: accentColor + '18',
            color: accentColor,
          }}>
            {agent.tier}
          </span>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
          Mandate
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
          {agent.mandate}
        </p>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
          Tools ({agent.tools.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {agent.tools.map((t) => (
            <div key={t} style={{
              fontFamily: 'monospace',
              fontSize: 12,
              padding: '3px 8px',
              borderRadius: 4,
              background: '#f8fafc',
              border: '1px solid var(--border)',
              color: '#334155',
            }}>
              {t}
            </div>
          ))}
        </div>
      </div>

      {'mcp_servers' in agent && agent.mcp_servers.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            MCP Servers
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {agent.mcp_servers.map((s) => <McpBadge key={s} server={s} />)}
          </div>
        </div>
      )}

      {'delegates_to' in agent && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
            Delegates to
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {agent.delegates_to.map((d) => (
              <div key={d} style={{
                fontFamily: 'monospace',
                fontSize: 12,
                padding: '3px 8px',
                borderRadius: 4,
                background: '#f8fafc',
                border: '1px solid var(--border)',
                color: '#334155',
              }}>
                {d}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
        Contract: <code style={{ fontSize: 11 }}>{agent.contract_file}</code>
      </div>
    </div>
  )
}

export function AgentsPage() {
  const { sessionId } = useSession()
  const [registry, setRegistry] = useState<AgentRegistry | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const url = sessionId ? `/api/agents?sessionId=${encodeURIComponent(sessionId)}` : '/api/agents'
    apiFetch(url)
      .then((r) => r.json() as Promise<AgentRegistry>)
      .then((data) => { setRegistry(data); setLoading(false) })
      .catch((e: unknown) => {
        setError(String(e))
        setLoading(false)
      })
  }, [sessionId])

  const selectedAgent = registry
    ? selectedId === registry.orchestrator.id
      ? registry.orchestrator
      : registry.departments.find((d) => d.id === selectedId) ?? null
    : null

  if (loading) {
    return <div style={{ padding: 32, color: 'var(--muted)' }}>Loading agent registry…</div>
  }

  if (error || !registry) {
    return <div style={{ padding: 32, color: 'var(--danger)' }}>Failed to load agent registry: {error}</div>
  }

  return (
    <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24, height: '100%', overflowY: 'auto' }}>
      <div>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>Agent Hierarchy</h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          {registry.departments.length + 1} managed agents · click any card to inspect
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedAgent ? '1fr 340px' : '1fr', gap: 20, alignItems: 'start' }}>
        {/* Left: hierarchy */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Orchestrator tier */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Orchestrator
            </div>
            <AgentCard
              agent={registry.orchestrator}
              selected={selectedId === registry.orchestrator.id}
              onClick={() => setSelectedId(registry.orchestrator.id)}
            />
          </div>

          {/* Connector */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
            <div style={{ width: 2, height: 10, background: 'var(--border)' }} />
            <div style={{ width: '80%', height: 2, background: 'var(--border)' }} />
          </div>

          {/* Department tier */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Department Heads
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {registry.departments.map((dept) => (
                <AgentCard
                  key={dept.id}
                  agent={dept}
                  selected={selectedId === dept.id}
                  onClick={() => setSelectedId(dept.id)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right: detail panel */}
        {selectedAgent && (
          <div style={{ position: 'sticky', top: 0 }}>
            <DetailPanel agent={selectedAgent} />
          </div>
        )}
      </div>
    </div>
  )
}
