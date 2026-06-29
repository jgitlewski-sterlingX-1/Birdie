import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from '../session'
import { apiFetch } from '../apiClient'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DepartmentAgent {
  id: string; name: string; tier: 'department'
  model: string; mandate: string; tools: string[]; mcp_servers: string[]
  contract_file: string
}
interface OrchestratorAgent {
  id: string; name: string; tier: 'orchestrator'
  model: string; mandate: string; tools: string[]; delegates_to: string[]
  contract_file: string
}
type AnyAgent = OrchestratorAgent | DepartmentAgent

interface AgentRegistry {
  orchestrator: OrchestratorAgent
  departments: DepartmentAgent[]
}

interface SavedPipeline { featureKey: string; name: string; agentIds: string[] }
interface SkillRule { id: string; text: string; isDefault: boolean }
interface SkillData { description: string; tools: string[]; rules: SkillRule[] }
type SkillRulesMap = Record<string, SkillData>

interface WorkflowDef {
  key: string; label: string; description: string
  defaultAgentIds: string[]; custom?: boolean
}

// ── Static app workflows ──────────────────────────────────────────────────────

const PREDEFINED: WorkflowDef[] = [
  { key: 'email_reply_draft',  label: 'Draft Email Reply',      description: 'Compose a contextual reply to an email thread.',        defaultAgentIds: ['receptionist', 'communications_manager'] },
  { key: 'inbox_triage',       label: 'Triage Inbox',           description: 'Classify, summarize, and label incoming emails.',        defaultAgentIds: ['receptionist'] },
  { key: 'meeting_schedule',   label: 'Schedule Meeting',        description: 'Find available times and create a calendar event.',     defaultAgentIds: ['calendar_manager'] },
  { key: 'task_create',        label: 'Create Task from Card',   description: 'Turn a card into a tracked task in ClickUp.',           defaultAgentIds: ['operations_manager'] },
  { key: 'financial_summary',  label: 'Financial Summary',       description: 'Pull and narrate financial data from BigQuery.',        defaultAgentIds: ['finance_manager'] },
  { key: 'full_outreach',      label: 'Full Outreach Workflow',  description: 'Read inbox context, then draft and send an outbound message.', defaultAgentIds: ['receptionist', 'communications_manager'] },
]
const PREDEFINED_KEYS = new Set(PREDEFINED.map((f) => f.key))

// ── Visual constants ──────────────────────────────────────────────────────────

const MODEL_LABEL: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8', 'claude-sonnet-4-6': 'Sonnet 4.6',
}
const TIER_COLOR: Record<string, string> = { orchestrator: '#6366f1', department: '#0ea5e9' }
const MCP_COLOR: Record<string, string> = {
  slack: '#4a154b', gmail: '#d93025', gcal: '#1a73e8', clickup: '#7b68ee', bigquery: '#4285f4',
  gmail_history: '#b45309',
  slack_history: '#2d1b4e',
}

// ── Shared atoms ──────────────────────────────────────────────────────────────

function Pill({ label, color, size = 'sm' }: { label: string; color?: string; size?: 'xs' | 'sm' }) {
  const fs = size === 'xs' ? 9 : 10
  return (
    <span style={{
      fontSize: fs, fontWeight: 700, padding: size === 'xs' ? '1px 5px' : '2px 7px',
      borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.02em',
      background: color ? color + '18' : '#f1f5f9',
      color: color ?? '#475569',
      border: `1px solid ${color ? color + '33' : '#e2e8f0'}`,
    }}>
      {label}
    </span>
  )
}

function TierDot({ tier }: { tier: string }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: TIER_COLOR[tier] ?? '#94a3b8', flexShrink: 0, display: 'inline-block' }} />
}

// ── Tab nav ───────────────────────────────────────────────────────────────────

type Tab = 'agents' | 'workflows'

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, padding: '0 24px', borderBottom: '1px solid var(--border)' }}>
      {(['agents', 'workflows'] as Tab[]).map((t) => (
        <button
          key={t} type="button" onClick={() => onChange(t)}
          style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontWeight: active === t ? 700 : 500, fontSize: 13,
            color: active === t ? '#6366f1' : 'var(--muted)',
            borderBottom: `2px solid ${active === t ? '#6366f1' : 'transparent'}`,
            marginBottom: -1, transition: 'color 0.15s',
            textTransform: 'capitalize',
          }}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

// ── Agents tab ────────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: AnyAgent }) {
  const [expanded, setExpanded] = useState(false)
  const accent = TIER_COLOR[agent.tier]
  const servers = 'mcp_servers' in agent ? agent.mcp_servers : []

  return (
    <div style={{
      borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--surface)',
      overflow: 'hidden', transition: 'border-color 0.15s',
    }}>
      <button
        type="button" onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px',
          width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TierDot tier={agent.tier} />
          <span style={{ fontWeight: 700, fontSize: 14, flex: 1, color: 'var(--text)' }}>{agent.name}</span>
          <Pill label={MODEL_LABEL[agent.model] ?? agent.model} />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, textAlign: 'left' }}>
          {agent.mandate}
        </p>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {servers.map((s) => <Pill key={s} label={s} color={MCP_COLOR[s]} size="xs" />)}
          <Pill label={`${agent.tools.length} tools`} size="xs" />
        </div>
      </button>

      {expanded && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '10px 0 6px' }}>
            Tools
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {agent.tools.map((t) => (
              <div key={t} style={{ fontFamily: 'monospace', fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#f8fafc', border: '1px solid var(--border)', color: '#334155' }}>
                {t}
              </div>
            ))}
          </div>
          {'delegates_to' in agent && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '10px 0 6px' }}>
                Delegates to
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {agent.delegates_to.map((d) => <Pill key={d} label={d} color={accent} size="xs" />)}
              </div>
            </>
          )}
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 10 }}>
            Contract: <code style={{ fontSize: 10 }}>{agent.contract_file}</code>
          </div>
        </div>
      )}
    </div>
  )
}

function AgentsTab({ agents }: { agents: AnyAgent[] }) {
  const orchestrator = agents.filter((a) => a.tier === 'orchestrator')
  const departments = agents.filter((a) => a.tier === 'department')

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Orchestrator
        </div>
        {orchestrator.map((a) => <AgentCard key={a.id} agent={a} />)}
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Department Heads
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
          {departments.map((a) => <AgentCard key={a.id} agent={a} />)}
        </div>
      </div>
    </div>
  )
}

// ── Workflows tab ─────────────────────────────────────────────────────────────

function AgentPickerDropdown({
  agents,
  excludeIds,
  onSelect,
  onClose,
}: {
  agents: AnyAgent[]
  excludeIds: string[]
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const available = agents.filter((a) => !excludeIds.includes(a.id))

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', zIndex: 100, top: '100%', left: 0, marginTop: 4,
        minWidth: 260, borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--surface)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        overflow: 'hidden',
      }}
    >
      {available.length === 0 ? (
        <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--muted)' }}>All agents already added</div>
      ) : (
        available.map((a) => (
          <button
            key={a.id} type="button"
            onClick={() => { onSelect(a.id); onClose() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer',
              textAlign: 'left', transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f8fafc' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
          >
            <TierDot tier={a.tier} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{a.name}</span>
            <Pill label={MODEL_LABEL[a.model] ?? a.model} size="xs" />
          </button>
        ))
      )}
    </div>
  )
}

function SkillCard({
  skillId, skillData,
  onAddRule, onDeleteRule,
}: {
  skillId: string
  skillData: SkillData
  onAddRule: (skillId: string, text: string) => Promise<void>
  onDeleteRule: (skillId: string, ruleId: string) => Promise<void>
}) {
  const [addingRule, setAddingRule] = useState(false)
  const [ruleInput, setRuleInput] = useState('')
  const [saving, setSaving] = useState(false)
  const color = MCP_COLOR[skillId]

  async function handleAdd() {
    if (!ruleInput.trim() || saving) return
    setSaving(true)
    await onAddRule(skillId, ruleInput.trim())
    setRuleInput('')
    setAddingRule(false)
    setSaving(false)
  }

  return (
    <div style={{ borderRadius: 6, border: `1px solid ${color ? color + '33' : 'var(--border)'}`, background: 'white', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: color ? color + '0c' : '#f8fafc', borderBottom: `1px solid ${color ? color + '22' : 'var(--border)'}` }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: color ?? '#94a3b8', flexShrink: 0 }} />
        <span style={{ fontWeight: 800, fontSize: 10, color: color ?? '#475569', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{skillId}</span>
      </div>

      <div style={{ padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        <p style={{ margin: 0, fontSize: 11.5, color: '#475569', lineHeight: 1.55 }}>
          {skillData.description}
        </p>

        {/* Default (base) rules — locked visual style */}
        {(() => {
          const defaults = skillData.rules.filter((r) => r.isDefault)
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Base Rules</span>
                <span style={{ fontSize: 9, color: '#cbd5e1' }}>— always applied</span>
              </div>
              {defaults.length === 0 ? (
                <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>No base rules.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {defaults.map((rule) => (
                    <div key={rule.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                      <span style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.5, flexShrink: 0 }}>◆</span>
                      <span style={{ flex: 1, fontSize: 11.5, color: '#64748b', lineHeight: 1.5 }}>{rule.text}</span>
                      <button
                        type="button" onClick={() => onDeleteRule(skillId, rule.id)}
                        style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#94a3b8', cursor: 'pointer', flexShrink: 0, lineHeight: 1.5 }}
                        title="Remove base rule"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}

        {/* Custom (supplemental) rules — editable, colored */}
        {(() => {
          const customs = skillData.rules.filter((r) => !r.isDefault)
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: color ?? '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Your Rules</span>
                <span style={{ fontSize: 9, color: '#cbd5e1' }}>— supplement the base</span>
              </div>
              {customs.length === 0 ? (
                <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>No custom rules yet. Add one below.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
                  {customs.map((rule) => (
                    <div key={rule.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                      <span style={{ color: color ?? '#94a3b8', fontSize: 12, lineHeight: 1.5, flexShrink: 0 }}>•</span>
                      <span style={{ flex: 1, fontSize: 11.5, color: '#1e293b', lineHeight: 1.5 }}>{rule.text}</span>
                      <button
                        type="button" onClick={() => onDeleteRule(skillId, rule.id)}
                        style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, border: '1px solid #fecaca', background: '#fef2f2', color: '#ef4444', cursor: 'pointer', flexShrink: 0, lineHeight: 1.5 }}
                        title="Remove rule"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {addingRule ? (
                <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <input
                    autoFocus value={ruleInput}
                    onChange={(e) => setRuleInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setAddingRule(false); setRuleInput('') } }}
                    placeholder="Describe the rule…"
                    style={{ flex: 1, padding: '4px 8px', fontSize: 11.5, borderRadius: 5, border: '1px solid #6366f1', outline: 'none', background: '#fafbff' }}
                  />
                  <button type="button" onClick={handleAdd} disabled={saving || !ruleInput.trim()}
                    style={{ padding: '4px 10px', borderRadius: 5, border: 'none', background: ruleInput.trim() ? '#6366f1' : '#e2e8f0', color: ruleInput.trim() ? 'white' : '#94a3b8', fontWeight: 700, fontSize: 11, cursor: ruleInput.trim() ? 'pointer' : 'default' }}>
                    {saving ? '…' : 'Add'}
                  </button>
                  <button type="button" onClick={() => { setAddingRule(false); setRuleInput('') }}
                    style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'white', fontSize: 11, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setAddingRule(true)}
                  style={{ alignSelf: 'flex-start', fontSize: 11, padding: '3px 9px', borderRadius: 5, border: '1px dashed #cbd5e1', background: 'transparent', color: '#64748b', cursor: 'pointer' }}>
                  + Add Rule
                </button>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function WorkflowStepRow({
  idx, total, agentId, agentById, skillRulesMap,
  onUp, onDown, onRemove, onAddRule, onDeleteRule,
}: {
  idx: number; total: number; agentId: string
  agentById: Record<string, AnyAgent>
  skillRulesMap: SkillRulesMap
  onUp: () => void; onDown: () => void; onRemove: () => void
  onAddRule: (skillId: string, text: string) => Promise<void>
  onDeleteRule: (skillId: string, ruleId: string) => Promise<void>
}) {
  const agent = agentById[agentId]
  const accent = agent ? TIER_COLOR[agent.tier] : '#94a3b8'
  const servers = agent && 'mcp_servers' in agent ? agent.mcp_servers : []

  return (
    <div style={{ borderRadius: 8, background: '#f8fafc', border: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%', background: accent,
          color: 'white', fontSize: 10, fontWeight: 800, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {idx + 1}
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {agent?.name ?? agentId}
        </span>
        {agent && <Pill label={MODEL_LABEL[agent.model] ?? agent.model} size="xs" />}
        <div style={{ display: 'flex', gap: 2 }}>
          {([
            { label: '↑', disabled: idx === 0,          onClick: onUp },
            { label: '↓', disabled: idx === total - 1,  onClick: onDown },
          ] as { label: string; disabled: boolean; onClick: () => void }[]).map(({ label, disabled, onClick }) => (
            <button key={label} type="button" onClick={onClick} disabled={disabled}
              style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'white', fontSize: 11, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.3 : 1 }}>
              {label}
            </button>
          ))}
          <button type="button" onClick={onRemove}
            style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #fecaca', background: '#fef2f2', color: '#ef4444', fontSize: 11, cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      </div>

      {/* Agent mandate + per-skill cards */}
      {agent && (
        <div style={{ padding: '0 10px 10px 40px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 11.5, color: '#64748b', lineHeight: 1.5 }}>
            {agent.mandate}
          </p>
          {servers.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Skills</div>
              {servers.map((s) => {
                const data = skillRulesMap[s]
                if (!data) return <Pill key={s} label={s} color={MCP_COLOR[s]} size="xs" />
                return (
                  <SkillCard
                    key={s} skillId={s} skillData={data}
                    onAddRule={onAddRule} onDeleteRule={onDeleteRule}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function WorkflowPanel({
  workflow, agentIds, allAgents, skillRulesMap, isOpen, isDirty, saving,
  onToggle, onAddAgent, onMoveUp, onMoveDown, onRemove, onSave, onAddRule, onDeleteRule,
}: {
  workflow: WorkflowDef; agentIds: string[]; allAgents: AnyAgent[]
  skillRulesMap: SkillRulesMap
  isOpen: boolean; isDirty: boolean; saving: boolean
  onToggle: () => void
  onAddAgent: (id: string) => void
  onMoveUp: (i: number) => void; onMoveDown: (i: number) => void; onRemove: (i: number) => void
  onSave: () => void
  onAddRule: (skillId: string, text: string) => Promise<void>
  onDeleteRule: (skillId: string, ruleId: string) => Promise<void>
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const agentById = Object.fromEntries(allAgents.map((a) => [a.id, a]))

  return (
    <div style={{ borderRadius: 10, border: `1.5px solid ${isOpen ? '#6366f1' : 'var(--border)'}`, background: 'var(--surface)', overflow: 'visible', transition: 'border-color 0.15s' }}>
      <button
        type="button" onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 16px', border: 'none', background: isOpen ? '#6366f108' : 'transparent', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: 12, color: 'var(--muted)', width: 12 }}>{isOpen ? '▼' : '▶'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{workflow.label}</span>
            {workflow.custom && <Pill label="custom" color="#8b5cf6" size="xs" />}
            {isDirty && <Pill label="unsaved" color="#d97706" size="xs" />}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{workflow.description}</div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {agentIds.length === 0 ? 'No agents' : `${agentIds.length} agent${agentIds.length !== 1 ? 's' : ''}`}
        </span>
      </button>

      {isOpen && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {agentIds.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 0', textAlign: 'center' }}>
              No agents — use <strong>+ Add Agent</strong> below.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
              {agentIds.map((id, i) => (
                <WorkflowStepRow
                  key={id + i} idx={i} total={agentIds.length} agentId={id} agentById={agentById}
                  skillRulesMap={skillRulesMap}
                  onUp={() => onMoveUp(i)} onDown={() => onMoveDown(i)} onRemove={() => onRemove(i)}
                  onAddRule={onAddRule} onDeleteRule={onDeleteRule}
                />
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <button
                type="button" onClick={() => setPickerOpen((v) => !v)}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px dashed #cbd5e1', background: 'white', fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                + Add Agent <span style={{ fontSize: 10 }}>▾</span>
              </button>
              {pickerOpen && (
                <AgentPickerDropdown
                  agents={allAgents} excludeIds={agentIds}
                  onSelect={onAddAgent}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
            <div style={{ flex: 1 }} />
            <button
              type="button" onClick={onSave} disabled={saving || !isDirty}
              style={{
                padding: '6px 16px', borderRadius: 6, border: 'none', fontWeight: 700, fontSize: 13,
                background: isDirty ? '#6366f1' : '#e2e8f0', color: isDirty ? 'white' : '#94a3b8',
                cursor: isDirty ? 'pointer' : 'default', transition: 'background 0.15s',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function NewWorkflowForm({ onSave, onCancel }: { onSave: (label: string, description: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  return (
    <div style={{ borderRadius: 10, border: '1.5px solid #6366f1', background: '#6366f108', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>New Workflow</div>
      <input
        value={label} onChange={(e) => setLabel(e.target.value)}
        placeholder="Workflow name (e.g. Weekly Digest)"
        style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }}
      />
      <input
        value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'white', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
        <button
          type="button" onClick={() => label.trim() && onSave(label.trim(), description.trim())} disabled={!label.trim()}
          style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: label.trim() ? '#6366f1' : '#e2e8f0', color: label.trim() ? 'white' : '#94a3b8', fontWeight: 700, fontSize: 12, cursor: label.trim() ? 'pointer' : 'default' }}
        >
          Create
        </button>
      </div>
    </div>
  )
}

function WorkflowsTab({
  allAgents, workflows, pipelines, savedPipelines, skillRulesMap, openKey, saving,
  onToggle, onAddAgent, onMoveUp, onMoveDown, onRemoveStep, onSave, onCreateWorkflow, onAddRule, onDeleteRule,
}: {
  allAgents: AnyAgent[]
  workflows: WorkflowDef[]
  pipelines: Record<string, string[]>
  savedPipelines: Record<string, string[]>
  skillRulesMap: SkillRulesMap
  openKey: string | null; saving: string | null
  onToggle: (key: string) => void
  onAddAgent: (key: string, agentId: string) => void
  onMoveUp: (key: string, i: number) => void
  onMoveDown: (key: string, i: number) => void
  onRemoveStep: (key: string, i: number) => void
  onSave: (key: string) => void
  onCreateWorkflow: (label: string, description: string) => void
  onAddRule: (skillId: string, text: string) => Promise<void>
  onDeleteRule: (skillId: string, ruleId: string) => Promise<void>
}) {
  const [showNew, setShowNew] = useState(false)

  const predefined = workflows.filter((w) => !w.custom)
  const custom = workflows.filter((w) => w.custom)

  const isDirty = (key: string) => {
    const cur = pipelines[key] ?? []
    const saved = savedPipelines[key] ?? []
    return cur.length !== saved.length || cur.some((id, i) => id !== saved[i])
  }

  function renderSection(label: string, list: WorkflowDef[]) {
    if (list.length === 0) return null
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          {label}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((wf) => (
            <WorkflowPanel
              key={wf.key} workflow={wf}
              agentIds={pipelines[wf.key] ?? []}
              allAgents={allAgents}
              skillRulesMap={skillRulesMap}
              isOpen={openKey === wf.key}
              isDirty={isDirty(wf.key)}
              saving={saving === wf.key}
              onToggle={() => onToggle(wf.key)}
              onAddAgent={(id) => onAddAgent(wf.key, id)}
              onMoveUp={(i) => onMoveUp(wf.key, i)}
              onMoveDown={(i) => onMoveDown(wf.key, i)}
              onRemove={(i) => onRemoveStep(wf.key, i)}
              onSave={() => onSave(wf.key)}
              onAddRule={onAddRule}
              onDeleteRule={onDeleteRule}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{workflows.length} workflow{workflows.length !== 1 ? 's' : ''}</span>
        <div style={{ flex: 1 }} />
        <button
          type="button" onClick={() => setShowNew((v) => !v)}
          style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #6366f1', background: showNew ? '#6366f1' : 'white', color: showNew ? 'white' : '#6366f1', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
        >
          + New Workflow
        </button>
      </div>

      {showNew && (
        <div style={{ marginBottom: 12 }}>
          <NewWorkflowForm
            onSave={(label, desc) => { onCreateWorkflow(label, desc); setShowNew(false) }}
            onCancel={() => setShowNew(false)}
          />
        </div>
      )}

      {renderSection('App Workflows', predefined)}
      {renderSection('Custom Workflows', custom)}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ProcessManagerPage() {
  const { sessionId } = useSession()
  const [tab, setTab] = useState<Tab>('agents')
  const [allAgents, setAllAgents] = useState<AnyAgent[]>([])
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([...PREDEFINED])
  const [pipelines, setPipelines] = useState<Record<string, string[]>>({})
  const [savedPipelines, setSavedPipelines] = useState<Record<string, string[]>>({})
  const [skillRulesMap, setSkillRulesMap] = useState<SkillRulesMap>({})
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
    Promise.all([
      apiFetch(`/api/agents${qs}`).then((r) => r.json() as Promise<AgentRegistry>),
      apiFetch(`/api/agent-pipelines${qs}`).then((r) => r.json() as Promise<{ pipelines: SavedPipeline[] }>),
      apiFetch(`/api/skill-rules${qs}`).then((r) => r.json() as Promise<{ skills: SkillRulesMap }>),
    ]).then(([registry, pipelineData, skillData]) => {
      setSkillRulesMap(skillData.skills ?? {})
      setAllAgents([registry.orchestrator, ...registry.departments])

      // Merge predefined defaults with saved pipelines
      const initial: Record<string, string[]> = {}
      for (const f of PREDEFINED) {
        const saved = pipelineData.pipelines.find((p) => p.featureKey === f.key)
        initial[f.key] = saved ? saved.agentIds : [...f.defaultAgentIds]
      }
      // Add custom workflows from DB
      const customWfs: WorkflowDef[] = []
      for (const p of pipelineData.pipelines) {
        if (!PREDEFINED_KEYS.has(p.featureKey)) {
          customWfs.push({ key: p.featureKey, label: p.name, description: '', defaultAgentIds: [], custom: true })
          initial[p.featureKey] = p.agentIds
        }
      }
      setWorkflows([...PREDEFINED, ...customWfs])
      setPipelines(initial)
      setSavedPipelines({ ...initial })
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [sessionId])

  const handleToggle = useCallback((key: string) => {
    setOpenKey((prev) => prev === key ? null : key)
  }, [])

  const handleAddAgent = useCallback((featureKey: string, agentId: string) => {
    setPipelines((prev) => {
      if ((prev[featureKey] ?? []).includes(agentId)) return prev
      return { ...prev, [featureKey]: [...(prev[featureKey] ?? []), agentId] }
    })
  }, [])

  const handleMoveUp = useCallback((featureKey: string, i: number) => {
    setPipelines((prev) => {
      const steps = [...(prev[featureKey] ?? [])];
      [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]
      return { ...prev, [featureKey]: steps }
    })
  }, [])

  const handleMoveDown = useCallback((featureKey: string, i: number) => {
    setPipelines((prev) => {
      const steps = [...(prev[featureKey] ?? [])];
      [steps[i], steps[i + 1]] = [steps[i + 1], steps[i]]
      return { ...prev, [featureKey]: steps }
    })
  }, [])

  const handleRemoveStep = useCallback((featureKey: string, i: number) => {
    setPipelines((prev) => {
      const steps = [...(prev[featureKey] ?? [])]
      steps.splice(i, 1)
      return { ...prev, [featureKey]: steps }
    })
  }, [])

  const handleSave = useCallback(async (featureKey: string) => {
    if (!sessionId) return
    const wf = workflows.find((w) => w.key === featureKey)
    if (!wf) return
    setSaving(featureKey)
    try {
      await apiFetch(`/api/agent-pipelines/${encodeURIComponent(featureKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, name: wf.label, agentIds: pipelines[featureKey] ?? [] }),
      })
      setSavedPipelines((prev) => ({ ...prev, [featureKey]: [...(pipelines[featureKey] ?? [])] }))
    } catch { /* leave dirty */ } finally {
      setSaving(null)
    }
  }, [sessionId, workflows, pipelines])

  const handleCreateWorkflow = useCallback((label: string, description: string) => {
    const key = 'custom_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '')
    const newWf: WorkflowDef = { key, label, description, defaultAgentIds: [], custom: true }
    setWorkflows((prev) => [...prev, newWf])
    setPipelines((prev) => ({ ...prev, [key]: [] }))
    setSavedPipelines((prev) => ({ ...prev, [key]: [] }))
    setOpenKey(key)
    setTab('workflows')
  }, [])

  const handleAddRule = useCallback(async (skillId: string, text: string) => {
    if (!sessionId) return
    try {
      const res = await apiFetch(`/api/skill-rules/${encodeURIComponent(skillId)}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ruleText: text }),
      })
      const rule = await res.json() as SkillRule
      setSkillRulesMap((prev) => {
        const existing = prev[skillId]
        if (!existing) return prev
        return { ...prev, [skillId]: { ...existing, rules: [...existing.rules, rule] } }
      })
    } catch { /* silent */ }
  }, [sessionId])

  const handleDeleteRule = useCallback(async (skillId: string, ruleId: string) => {
    if (!sessionId) return
    try {
      await apiFetch(`/api/skill-rules/${encodeURIComponent(skillId)}/rules/${encodeURIComponent(ruleId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      setSkillRulesMap((prev) => {
        const existing = prev[skillId]
        if (!existing) return prev
        return { ...prev, [skillId]: { ...existing, rules: existing.rules.filter((r) => r.id !== ruleId) } }
      })
    } catch { /* silent */ }
  }, [sessionId])

  if (loading) return <div style={{ padding: 32, color: 'var(--muted)' }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px 0', borderBottom: '1px solid transparent' }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 800 }}>Process Manager</h1>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === 'agents' && <AgentsTab agents={allAgents} />}

      {tab === 'workflows' && (
        <WorkflowsTab
          allAgents={allAgents} workflows={workflows}
          pipelines={pipelines} savedPipelines={savedPipelines}
          skillRulesMap={skillRulesMap}
          openKey={openKey} saving={saving}
          onToggle={handleToggle}
          onAddAgent={handleAddAgent}
          onMoveUp={handleMoveUp} onMoveDown={handleMoveDown}
          onRemoveStep={handleRemoveStep}
          onSave={handleSave}
          onCreateWorkflow={handleCreateWorkflow}
          onAddRule={handleAddRule}
          onDeleteRule={handleDeleteRule}
        />
      )}
    </div>
  )
}
