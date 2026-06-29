import { useState, useCallback } from 'react'
import { useSession } from '../session'
import { apiFetch } from '../apiClient'

// ── Step definitions ──────────────────────────────────────────────────────────

interface RuleTemplate {
  id: string
  prompt: string          // "Prioritize emails from"
  placeholder: string     // shown inside the input
  defaultValue: string    // pre-filled value
  checked: boolean        // checked by default?
  build: (value: string) => string  // turns value → final rule text
}

interface SkillStep {
  type: 'skill'
  skillId: string
  emoji: string
  color: string
  title: string
  description: string
  templates: RuleTemplate[]
}

interface InfoStep {
  type: 'welcome' | 'complete'
  title: string
  subtitle: string
}

type Step = InfoStep | SkillStep

const STEPS: Step[] = [
  {
    type: 'welcome',
    title: 'Welcome to your AI Workbench',
    subtitle: "Let's spend 2 minutes personalizing your agents. You can change any of this later in Process Manager.",
  },
  {
    type: 'skill',
    skillId: 'gmail',
    emoji: '📧',
    color: '#d93025',
    title: 'Email',
    description: 'Your email assistant reads your inbox, triages messages, and drafts replies. Set rules to tell it how to prioritize and respond.',
    templates: [
      {
        id: 'priority_sender',
        prompt: 'Prioritize emails from',
        placeholder: 'e.g. @sterlinglawyers.com or client@example.com',
        defaultValue: '',
        checked: true,
        build: (v) => `Prioritize emails from ${v}`,
      },
      {
        id: 'reply_tone',
        prompt: 'Draft all replies in',
        placeholder: 'e.g. formal, concise, friendly',
        defaultValue: 'formal',
        checked: true,
        build: (v) => `Draft all replies in ${v} tone`,
      },
      {
        id: 'skip_senders',
        prompt: 'Skip emails from',
        placeholder: 'e.g. newsletters, marketing lists',
        defaultValue: 'newsletters and automated senders',
        checked: true,
        build: (v) => `Skip emails from ${v}`,
      },
      {
        id: 'confidentiality',
        prompt: 'Add a confidentiality note to all drafts for',
        placeholder: 'e.g. opposing counsel, external parties',
        defaultValue: 'external parties',
        checked: false,
        build: (v) => `Add an attorney-client confidentiality note to all drafts sent to ${v}`,
      },
    ],
  },
  {
    type: 'skill',
    skillId: 'slack',
    emoji: '💬',
    color: '#4a154b',
    title: 'Slack',
    description: 'Your Slack assistant monitors messages and helps you respond across channels.',
    templates: [
      {
        id: 'watch_channels',
        prompt: 'Monitor these channels',
        placeholder: 'e.g. #general, #client-updates',
        defaultValue: '',
        checked: true,
        build: (v) => `Monitor messages in ${v}`,
      },
      {
        id: 'urgent_keywords',
        prompt: 'Escalate messages containing',
        placeholder: 'e.g. urgent, deadline, emergency',
        defaultValue: 'urgent, deadline, emergency',
        checked: true,
        build: (v) => `Escalate messages containing: ${v}`,
      },
      {
        id: 'hours',
        prompt: 'Only process messages during',
        placeholder: 'e.g. Mon–Fri 9am–6pm CT',
        defaultValue: 'Mon–Fri 9am–6pm CT',
        checked: true,
        build: (v) => `Only process messages during ${v}`,
      },
    ],
  },
  {
    type: 'skill',
    skillId: 'gcal',
    emoji: '📅',
    color: '#1a73e8',
    title: 'Calendar',
    description: 'Your calendar assistant finds available times, creates events, and keeps your schedule organized.',
    templates: [
      {
        id: 'buffer',
        prompt: 'Add buffer time after every meeting',
        placeholder: 'e.g. 15 minutes',
        defaultValue: '15 minutes',
        checked: true,
        build: (v) => `Add ${v} buffer after each meeting`,
      },
      {
        id: 'focus_time',
        prompt: 'Block focus time daily',
        placeholder: 'e.g. 9am–11am',
        defaultValue: '',
        checked: false,
        build: (v) => `Block ${v} daily for focused work — no meetings`,
      },
      {
        id: 'video_link',
        prompt: 'Always add a video link using',
        placeholder: 'e.g. Google Meet, Zoom',
        defaultValue: 'Google Meet',
        checked: true,
        build: (v) => `Always add a ${v} link to new meetings`,
      },
    ],
  },
  {
    type: 'skill',
    skillId: 'clickup',
    emoji: '✅',
    color: '#7b68ee',
    title: 'Tasks',
    description: 'Your task assistant creates and updates work items in ClickUp from emails and Slack messages.',
    templates: [
      {
        id: 'default_assignee',
        prompt: 'Assign new tasks to',
        placeholder: 'e.g. me, team-lead, or leave unassigned',
        defaultValue: 'me',
        checked: true,
        build: (v) => `Assign new tasks to ${v} by default`,
      },
      {
        id: 'urgent_threshold',
        prompt: 'Mark as urgent if deadline is within',
        placeholder: 'e.g. 2 days, 48 hours',
        defaultValue: '2 days',
        checked: true,
        build: (v) => `Flag task as urgent if deadline is within ${v}`,
      },
      {
        id: 'source_tag',
        prompt: 'Tag tasks with their source',
        placeholder: 'e.g. email, slack',
        defaultValue: 'always (email or slack)',
        checked: true,
        build: (v) => `Tag every task with its source for audit trail (${v})`,
      },
    ],
  },
  {
    type: 'skill',
    skillId: 'bigquery',
    emoji: '📊',
    color: '#4285f4',
    title: 'Data & Reports',
    description: 'Your data assistant queries financial and operational data and surfaces insights.',
    templates: [
      {
        id: 'weekly_report',
        prompt: 'Generate a weekly summary every',
        placeholder: 'e.g. Monday at 8am',
        defaultValue: 'Monday at 8am',
        checked: false,
        build: (v) => `Generate weekly financial summary every ${v}`,
      },
      {
        id: 'alert_metric',
        prompt: 'Alert me when revenue drops below',
        placeholder: 'e.g. $10,000 / week',
        defaultValue: '',
        checked: false,
        build: (v) => `Alert when weekly revenue drops below ${v}`,
      },
    ],
  },
  {
    type: 'complete',
    title: "You're all set!",
    subtitle: "Your agents are configured. You can update rules anytime from Process Manager → Workflows.",
  },
]

const SKILL_STEPS = STEPS.filter((s): s is SkillStep => s.type === 'skill')

// ── State types ───────────────────────────────────────────────────────────────

type TemplateState = Record<string, { checked: boolean; value: string }>  // templateId → state
type StepRuleState = Record<number, TemplateState>  // stepIndex → TemplateState

function initStepState(): StepRuleState {
  const state: StepRuleState = {}
  STEPS.forEach((step, i) => {
    if (step.type !== 'skill') return
    state[i] = {}
    step.templates.forEach((t) => {
      state[i][t.id] = { checked: t.checked, value: t.defaultValue }
    })
  })
  return state
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 28 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === current ? 24 : 8, height: 8, borderRadius: 99,
          background: i < current ? '#6366f1' : i === current ? '#6366f1' : '#e2e8f0',
          opacity: i > current ? 0.4 : 1,
          transition: 'width 0.2s, background 0.2s',
        }} />
      ))}
    </div>
  )
}

function TemplateRow({
  template, state,
  onChange,
}: {
  template: RuleTemplate
  state: { checked: boolean; value: string }
  onChange: (patch: Partial<{ checked: boolean; value: string }>) => void
}) {
  const preview = state.value.trim() ? template.build(state.value.trim()) : null
  return (
    <div style={{
      borderRadius: 8, border: `1.5px solid ${state.checked ? '#6366f133' : '#e2e8f0'}`,
      background: state.checked ? '#fafbff' : '#f8fafc',
      padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 7,
      transition: 'border-color 0.15s, background 0.15s',
    }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox" checked={state.checked}
          onChange={(e) => onChange({ checked: e.target.checked })}
          style={{ marginTop: 2, accentColor: '#6366f1', flexShrink: 0 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: state.checked ? '#1e293b' : '#94a3b8' }}>
          {template.prompt}
        </span>
      </label>

      {state.checked && (
        <input
          type="text"
          value={state.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={template.placeholder}
          style={{
            marginLeft: 26, padding: '6px 10px', fontSize: 13, borderRadius: 6,
            border: '1px solid #cbd5e1', outline: 'none', background: 'white',
            width: 'calc(100% - 26px)', boxSizing: 'border-box',
          }}
        />
      )}

      {state.checked && preview && (
        <div style={{ marginLeft: 26, fontSize: 11.5, color: '#6366f1', fontStyle: 'italic' }}>
          → "{preview}"
        </div>
      )}
    </div>
  )
}

// ── Onboarding page ───────────────────────────────────────────────────────────

export function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const { sessionId } = useSession()
  const [currentStep, setCurrentStep] = useState(0)
  const [stepState, setStepState] = useState<StepRuleState>(initStepState)
  const [customRuleInputs, setCustomRuleInputs] = useState<Record<number, string>>({})
  const [customRules, setCustomRules] = useState<Record<number, string[]>>({})
  const [saving, setSaving] = useState(false)

  const step = STEPS[currentStep]
  const isFirst = currentStep === 0
  const isLast = currentStep === STEPS.length - 1

  const patchTemplate = useCallback((stepIdx: number, templateId: string, patch: Partial<{ checked: boolean; value: string }>) => {
    setStepState((prev) => ({
      ...prev,
      [stepIdx]: { ...prev[stepIdx], [templateId]: { ...prev[stepIdx][templateId], ...patch } },
    }))
  }, [])

  async function saveCurrentSkillRules() {
    if (step.type !== 'skill' || !sessionId) return
    const templates = step.templates
    const state = stepState[currentStep] ?? {}
    const custom = customRules[currentStep] ?? []

    const rulesToSave: string[] = []

    for (const t of templates) {
      const s = state[t.id]
      if (s?.checked && s.value.trim()) {
        rulesToSave.push(t.build(s.value.trim()))
      }
    }
    for (const r of custom) {
      if (r.trim()) rulesToSave.push(r.trim())
    }

    for (const ruleText of rulesToSave) {
      try {
        await apiFetch(`/api/skill-rules/${encodeURIComponent(step.skillId)}/rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, ruleText }),
        })
      } catch { /* non-blocking */ }
    }
  }

  async function handleNext() {
    if (saving) return
    setSaving(true)
    await saveCurrentSkillRules()
    setSaving(false)

    if (isLast) {
      if (sessionId) {
        try {
          await apiFetch('/api/user-settings/onboarding-complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          })
        } catch { /* proceed anyway */ }
      }
      onComplete()
    } else {
      setCurrentStep((p) => p + 1)
    }
  }

  function handleBack() {
    if (!isFirst) setCurrentStep((p) => p - 1)
  }

  function addCustomRule(stepIdx: number) {
    const text = (customRuleInputs[stepIdx] ?? '').trim()
    if (!text) return
    setCustomRules((prev) => ({ ...prev, [stepIdx]: [...(prev[stepIdx] ?? []), text] }))
    setCustomRuleInputs((prev) => ({ ...prev, [stepIdx]: '' }))
  }

  function removeCustomRule(stepIdx: number, ruleIdx: number) {
    setCustomRules((prev) => {
      const updated = [...(prev[stepIdx] ?? [])]
      updated.splice(ruleIdx, 1)
      return { ...prev, [stepIdx]: updated }
    })
  }

  // Count rules that will be saved for the current skill step
  const rulesReadyCount = step.type === 'skill'
    ? step.templates.filter((t) => {
        const s = stepState[currentStep]?.[t.id]
        return s?.checked && s.value.trim()
      }).length + (customRules[currentStep]?.length ?? 0)
    : 0

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'linear-gradient(135deg, #f0f4ff 0%, #f8fafc 60%, #fdf4ff 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, zIndex: 1000,
    }}>
      <div style={{
        width: '100%', maxWidth: 580, background: 'white', borderRadius: 16,
        boxShadow: '0 24px 64px rgba(99,102,241,0.12), 0 4px 16px rgba(0,0,0,0.06)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        {/* Top bar */}
        <div style={{ padding: '24px 28px 0', borderBottom: 'none' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 20 }}>
            Workbench Setup
          </div>
          <ProgressDots current={currentStep} total={STEPS.length} />
        </div>

        {/* Content */}
        <div style={{ padding: '0 28px 24px', overflowY: 'auto', maxHeight: '70vh' }}>
          {step.type === 'welcome' && (
            <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>🤖</div>
              <h1 style={{ margin: '0 0 12px', fontSize: 26, fontWeight: 800, color: '#1e293b' }}>
                {step.title}
              </h1>
              <p style={{ margin: 0, fontSize: 15, color: '#64748b', lineHeight: 1.6 }}>
                {step.subtitle}
              </p>
              <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                {SKILL_STEPS.map((s) => (
                  <div key={s.skillId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 99, background: s.color + '12', border: `1px solid ${s.color}33` }}>
                    <span style={{ fontSize: 14 }}>{s.emoji}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step.type === 'skill' && (
            <div style={{ paddingTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 28 }}>{step.emoji}</span>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: step.color }}>{step.title}</h2>
              </div>
              <p style={{ margin: '0 0 20px', fontSize: 13.5, color: '#64748b', lineHeight: 1.6 }}>
                {step.description}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {step.templates.map((t) => (
                  <TemplateRow
                    key={t.id} template={t}
                    state={stepState[currentStep]?.[t.id] ?? { checked: t.checked, value: t.defaultValue }}
                    onChange={(patch) => patchTemplate(currentStep, t.id, patch)}
                  />
                ))}

                {/* Custom rules already added */}
                {(customRules[currentStep] ?? []).map((rule, ri) => (
                  <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, border: '1.5px solid #6366f133', background: '#fafbff' }}>
                    <span style={{ flex: 1, fontSize: 13, color: '#1e293b' }}>→ "{rule}"</span>
                    <button type="button" onClick={() => removeCustomRule(currentStep, ri)}
                      style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, border: '1px solid #fecaca', background: '#fef2f2', color: '#ef4444', cursor: 'pointer' }}>
                      ✕
                    </button>
                  </div>
                ))}

                {/* Custom rule input */}
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <input
                    type="text"
                    value={customRuleInputs[currentStep] ?? ''}
                    onChange={(e) => setCustomRuleInputs((p) => ({ ...p, [currentStep]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && addCustomRule(currentStep)}
                    placeholder="+ Add your own rule…"
                    style={{ flex: 1, padding: '7px 12px', fontSize: 13, borderRadius: 6, border: '1px dashed #cbd5e1', outline: 'none', background: 'white' }}
                  />
                  <button type="button" onClick={() => addCustomRule(currentStep)}
                    disabled={!(customRuleInputs[currentStep] ?? '').trim()}
                    style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: (customRuleInputs[currentStep] ?? '').trim() ? '#6366f1' : '#e2e8f0', color: (customRuleInputs[currentStep] ?? '').trim() ? 'white' : '#94a3b8', fontWeight: 700, fontSize: 12, cursor: (customRuleInputs[currentStep] ?? '').trim() ? 'pointer' : 'default' }}>
                    Add
                  </button>
                </div>
              </div>

              {step.type === 'skill' && rulesReadyCount > 0 && (
                <div style={{ marginTop: 14, fontSize: 12, color: '#6366f1', fontWeight: 600 }}>
                  {rulesReadyCount} rule{rulesReadyCount !== 1 ? 's' : ''} will be saved for {step.title}
                </div>
              )}
            </div>
          )}

          {step.type === 'complete' && (
            <div style={{ textAlign: 'center', padding: '20px 0 8px' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>✨</div>
              <h1 style={{ margin: '0 0 12px', fontSize: 26, fontWeight: 800, color: '#1e293b' }}>
                {step.title}
              </h1>
              <p style={{ margin: '0 0 24px', fontSize: 15, color: '#64748b', lineHeight: 1.6 }}>
                {step.subtitle}
              </p>
              <div style={{ background: '#f8fafc', borderRadius: 10, border: '1px solid var(--border)', padding: '14px 18px', textAlign: 'left' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Rules configured</div>
                {SKILL_STEPS.map((s) => {
                  const stepIdx = STEPS.indexOf(s)
                  const count = s.templates.filter((t) => {
                    const st = stepState[stepIdx]?.[t.id]
                    return st?.checked && st.value.trim()
                  }).length + (customRules[stepIdx]?.length ?? 0)
                  return (
                    <div key={s.skillId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 15 }}>{s.emoji}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#334155', flex: 1 }}>{s.title}</span>
                      <span style={{ fontSize: 12, color: count > 0 ? '#6366f1' : '#94a3b8', fontWeight: 600 }}>
                        {count > 0 ? `${count} rule${count !== 1 ? 's' : ''}` : 'skipped'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div style={{ padding: '16px 28px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button type="button" onClick={handleBack} disabled={isFirst}
              style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', fontSize: 13, fontWeight: 600, color: isFirst ? '#cbd5e1' : '#475569', cursor: isFirst ? 'default' : 'pointer' }}>
              ← Back
            </button>
            {/* DEV ONLY — remove before go-live */}
            <button
              type="button"
              onClick={async () => {
                if (sessionId) {
                  try {
                    await apiFetch('/api/user-settings/onboarding-complete', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ sessionId }),
                    })
                  } catch { /* proceed anyway */ }
                }
                onComplete()
              }}
              style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
            >
              Skip setup
            </button>
          </div>

          <button type="button" onClick={handleNext} disabled={saving}
            style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: '#6366f1', color: 'white', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1, minWidth: 120 }}>
            {saving ? 'Saving…' : isLast ? 'Open Workspace →' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}
