import { useState } from 'react';
import type { useAgents } from '../agentsStore';
import type { Board, AgentId, FilterField, FilterOperator, FilterAction, Card } from '../types';
import { AGENTS, type AgentDefinition } from '../agents';

interface Props {
  agentsStore: ReturnType<typeof useAgents>;
  board: Board;
  gmailConnected: boolean;
  slackConnected: boolean;
}

const FIELD_LABELS: Record<FilterField, string> = {
  from: 'Sender',
  domain: 'Sender domain',
  subject: 'Subject line',
  keyword: 'Keyword',
};

const OP_LABELS: Record<FilterOperator, string> = {
  contains: 'contains',
  is: 'is exactly',
  not_contains: 'does not contain',
};

const ACTION_LABELS: Record<FilterAction, string> = {
  skip: 'Skip (ignore it)',
  escalate: 'Escalate (high priority)',
  flag: 'Flag for review',
};

const ACTION_COLORS: Record<FilterAction, { bg: string; color: string }> = {
  skip: { bg: '#fee2e2', color: '#991b1b' },
  escalate: { bg: '#fef9c3', color: '#713f12' },
  flag: { bg: '#e0f2fe', color: '#075985' },
};

function recentCards(board: Board, source: 'gmail' | 'slack'): Card[] {
  return Object.values(board.cards)
    .filter((c) => c.source === source)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isIntegrationConnected(agent: AgentDefinition, gmailConnected: boolean, slackConnected: boolean): boolean {
  if (!agent.integration) return true; // Coordinator needs no specific integration
  if (agent.integration === 'gmail') return gmailConnected;
  if (agent.integration === 'slack') return slackConnected;
  return false;
}

interface AgentCardProps {
  def: AgentDefinition;
  agentsStore: ReturnType<typeof useAgents>;
  board: Board;
  gmailConnected: boolean;
  slackConnected: boolean;
}

function AgentCard({ def, agentsStore, board, gmailConnected, slackConnected }: AgentCardProps) {
  const config = agentsStore.getConfig(def.id);
  const connected = isIntegrationConnected(def, gmailConnected, slackConnected);
  const canEnable = !def.comingSoon && connected;

  const [section, setSection] = useState<'instructions' | 'filters' | 'activity' | null>(null);
  const [instructionDraft, setInstructionDraft] = useState(config.instructions);
  const [savedInstructions, setSavedInstructions] = useState(false);

  // New filter form state
  const [nField, setNField] = useState<FilterField>(def.filterFields[0]?.value ?? 'keyword');
  const [nOp, setNOp] = useState<FilterOperator>('contains');
  const [nValue, setNValue] = useState('');
  const [nAction, setNAction] = useState<FilterAction>('skip');

  const toggleSection = (s: typeof section) => setSection((prev) => (prev === s ? null : s));

  const statusBadge = (() => {
    if (def.comingSoon) return { label: 'Coming soon', bg: '#f1f5f9', color: '#64748b' };
    if (!connected) return { label: 'Not connected', bg: '#fef3c7', color: '#92400e' };
    if (!config.enabled) return { label: 'Paused', bg: '#fff7ed', color: '#c2410c' };
    return { label: 'Active', bg: '#dcfce7', color: '#166534' };
  })();

  const handleSaveInstructions = () => {
    agentsStore.setInstructions(def.id as AgentId, instructionDraft);
    setSavedInstructions(true);
    window.setTimeout(() => setSavedInstructions(false), 2000);
  };

  const handleAddFilter = () => {
    if (!nValue.trim()) return;
    agentsStore.addFilter(def.id as AgentId, {
      field: nField,
      operator: nOp,
      value: nValue.trim(),
      action: nAction,
    });
    setNValue('');
  };

  const cardSource = def.id === 'email' ? 'gmail' : def.id === 'slack' ? 'slack' : null;
  const activityCards = cardSource ? recentCards(board, cardSource) : [];

  const selectStyle: React.CSSProperties = {
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '5px 8px',
    fontSize: 13,
    background: '#fff',
  };

  return (
    <div
      className="panel"
      style={{
        padding: 0,
        overflow: 'hidden',
        opacity: def.comingSoon ? 0.75 : 1,
      }}
    >
      {/* Header */}
      <div style={{ padding: '14px 16px', display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1 }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{def.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15 }}>{def.name}</strong>
                <span
                  className="badge"
                  style={{ background: statusBadge.bg, color: statusBadge.color, fontSize: 11 }}
                >
                  {statusBadge.label}
                </span>
              </div>
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>{def.tagline}</div>
            </div>
          </div>

          {/* Toggle */}
          {!def.comingSoon && (
            <button
              type="button"
              className={config.enabled && connected ? 'btn btn-ghost' : 'btn btn-ghost'}
              disabled={!canEnable && !config.enabled}
              onClick={() => agentsStore.toggleAgent(def.id as AgentId)}
              style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {config.enabled && connected ? 'Pause' : 'Resume'}
            </button>
          )}
        </div>

        {/* Workflow */}
        <div
          style={{
            background: '#f8fafc',
            borderRadius: 8,
            padding: '10px 12px',
            display: 'grid',
            gap: 10,
          }}
        >
          {/* Trigger */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 4 }}>
              WHEN
            </div>
            <div style={{ fontSize: 13, color: '#334155', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>→</span>
              {def.trigger}
            </div>
          </div>

          {/* Steps */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#94a3b8', marginBottom: 6 }}>
              THEN
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {def.steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span
                    style={{
                      minWidth: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: step.requiresApproval ? '#fef9c3' : '#e2e8f0',
                      color: step.requiresApproval ? '#713f12' : '#475569',
                      fontSize: 11,
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#1e293b', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {step.label}
                      {step.requiresApproval && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            background: '#fef9c3',
                            color: '#713f12',
                            borderRadius: 4,
                            padding: '1px 5px',
                          }}
                        >
                          ✋ Requires your approval
                        </span>
                      )}
                    </div>
                    {step.detail && (
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>{step.detail}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Coming soon notice */}
        {def.comingSoon && (
          <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
            This agent is coming soon. Connect the integration when it's available.
          </div>
        )}

        {/* Not connected notice */}
        {!def.comingSoon && !connected && (
          <div style={{ fontSize: 12, color: '#92400e' }}>
            Connect {def.integration} in the Integrations tab to activate this agent.
          </div>
        )}
      </div>

      {/* Section tabs — only when not coming soon */}
      {!def.comingSoon && (
        <>
          <div
            style={{
              borderTop: '1px solid #f1f5f9',
              display: 'flex',
              gap: 0,
            }}
          >
            {(['instructions', 'filters', 'activity'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleSection(s)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  fontSize: 12,
                  fontWeight: section === s ? 600 : 400,
                  background: section === s ? '#f8fafc' : 'transparent',
                  color: section === s ? '#1e293b' : '#64748b',
                  border: 'none',
                  borderBottom: section === s ? '2px solid #3b82f6' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                }}
              >
                {s === 'instructions' ? 'Instructions' : s === 'filters' ? `Filters ${config.filters.length > 0 ? `(${config.filters.length})` : ''}` : 'Recent activity'}
              </button>
            ))}
          </div>

          {/* Instructions panel */}
          {section === 'instructions' && (
            <div style={{ padding: '12px 16px', display: 'grid', gap: 8, borderTop: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Write guidance for this agent — your preferences, priorities, and communication style. The agent reads this before taking action.
              </div>
              <textarea
                value={instructionDraft}
                onChange={(e) => {
                  setInstructionDraft(e.target.value);
                  setSavedInstructions(false);
                }}
                placeholder={
                  def.id === 'email'
                    ? "e.g. I'm a lawyer. Keep drafts formal and concise. Always flag anything from opposing counsel as high priority."
                    : "Give this agent specific guidance about your preferences..."
                }
                rows={4}
                style={{
                  border: '1px solid #cbd5e1',
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 13,
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                {savedInstructions && (
                  <span style={{ fontSize: 12, color: '#16a34a' }}>Saved</span>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveInstructions}
                  style={{ fontSize: 13 }}
                >
                  Save instructions
                </button>
              </div>
            </div>
          )}

          {/* Filters panel */}
          {section === 'filters' && (
            <div style={{ padding: '12px 16px', display: 'grid', gap: 10, borderTop: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Rules let you control which messages this agent acts on. Rules are checked in order — the first match wins.
              </div>

              {/* Existing filters */}
              {config.filters.length > 0 && (
                <div style={{ display: 'grid', gap: 6 }}>
                  {config.filters.map((f) => {
                    const colors = ACTION_COLORS[f.action];
                    return (
                      <div
                        key={f.id}
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'center',
                          fontSize: 12,
                          background: '#f8fafc',
                          borderRadius: 6,
                          padding: '6px 10px',
                        }}
                      >
                        <span style={{ color: '#64748b' }}>When</span>
                        <span style={{ color: '#334155', fontWeight: 500 }}>{FIELD_LABELS[f.field]}</span>
                        <span style={{ color: '#64748b' }}>{OP_LABELS[f.operator]}</span>
                        <span
                          style={{
                            background: '#e2e8f0',
                            color: '#334155',
                            borderRadius: 4,
                            padding: '1px 6px',
                            fontFamily: 'monospace',
                          }}
                        >
                          {f.value}
                        </span>
                        <span style={{ color: '#94a3b8', margin: '0 2px' }}>→</span>
                        <span
                          style={{
                            background: colors.bg,
                            color: colors.color,
                            borderRadius: 4,
                            padding: '1px 6px',
                            fontWeight: 600,
                          }}
                        >
                          {ACTION_LABELS[f.action]}
                        </span>
                        <button
                          type="button"
                          onClick={() => agentsStore.removeFilter(def.id as AgentId, f.id)}
                          style={{
                            marginLeft: 'auto',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#94a3b8',
                            fontSize: 14,
                            padding: '0 2px',
                          }}
                          aria-label="Remove filter"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add filter form */}
              {def.filterFields.length > 0 && (
                <div
                  style={{
                    background: '#f8fafc',
                    borderRadius: 8,
                    padding: '10px 12px',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Add a rule</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>When</span>
                    <select value={nField} onChange={(e) => setNField(e.target.value as FilterField)} style={selectStyle}>
                      {def.filterFields.map((ff) => (
                        <option key={ff.value} value={ff.value}>{ff.label}</option>
                      ))}
                    </select>
                    <select value={nOp} onChange={(e) => setNOp(e.target.value as FilterOperator)} style={selectStyle}>
                      <option value="contains">contains</option>
                      <option value="is">is exactly</option>
                      <option value="not_contains">does not contain</option>
                    </select>
                    <input
                      value={nValue}
                      onChange={(e) => setNValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddFilter(); }}
                      placeholder="value…"
                      style={{
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        padding: '5px 8px',
                        fontSize: 13,
                        width: 130,
                      }}
                    />
                    <span style={{ fontSize: 12, color: '#64748b' }}>→</span>
                    <select value={nAction} onChange={(e) => setNAction(e.target.value as FilterAction)} style={selectStyle}>
                      <option value="skip">Skip (ignore it)</option>
                      <option value="escalate">Escalate (high priority)</option>
                      <option value="flag">Flag for review</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleAddFilter}
                      disabled={!nValue.trim()}
                      style={{ fontSize: 12 }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {def.filterFields.length === 0 && (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>No filters available for this agent.</div>
              )}
            </div>
          )}

          {/* Recent activity panel */}
          {section === 'activity' && (
            <div style={{ padding: '12px 16px', display: 'grid', gap: 8, borderTop: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Cards this agent has created in your current session.
              </div>
              {activityCards.length > 0 ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  {activityCards.map((card) => (
                    <div
                      key={card.id}
                      style={{
                        background: '#f8fafc',
                        borderRadius: 6,
                        padding: '8px 10px',
                        display: 'grid',
                        gap: 2,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>{card.title}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        {card.completed ? 'Completed · ' : ''}
                        {timeAgo(card.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>
                  No cards yet. {!connected ? 'Connect the integration to get started.' : 'Cards will appear here once the agent starts running.'}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function AgentsTab({ agentsStore, board, gmailConnected, slackConnected }: Props) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ color: '#64748b', fontSize: 13 }}>
        Each agent runs a workflow on your behalf. You control what it does, what it skips, and nothing leaves without your approval.
      </div>
      {AGENTS.map((def) => (
        <AgentCard
          key={def.id}
          def={def}
          agentsStore={agentsStore}
          board={board}
          gmailConnected={gmailConnected}
          slackConnected={slackConnected}
        />
      ))}
    </div>
  );
}
