import { useEffect, useState } from 'react'
import type { useSkills } from '../skillsStore'
import type { useApprovals } from '../approvalsStore'
import type { SkillCategory } from '../types'
import { useSession } from '../session'
import { ApprovalLogView } from '../components/ApprovalLogView'
import { AdminPanel } from '../components/AdminPanel'
import { useFlags } from '../flags'
import {
  connectClaude,
  disconnectClaude,
  disconnectGmail,
  disconnectSlack,
  getIntegrationsStatus,
  getSalesforceStatus,
  setDefaultGmailAccount,
  startGmailConnect,
  startSlackConnect,
  type ClaudeIntegrationStatus,
  type GmailIntegrationStatus,
  type SalesforceStatus,
  type SlackIntegrationStatus,
} from '../integrationsApi'
import {
  createClaudeSkill,
  deleteClaudeSkill,
  listClaudeSkills,
  type ClaudeSkill,
} from '../skillsApi'

type Tab = 'skills' | 'approvals' | 'integrations' | 'admin'

interface SettingsPageProps {
  skillsStore: ReturnType<typeof useSkills>
  approvalsStore: ReturnType<typeof useApprovals>
}

export function SettingsPage({ skillsStore, approvalsStore }: SettingsPageProps) {
  const [tab, setTab] = useState<Tab>('skills')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<SkillCategory>('email')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [gmail, setGmail] = useState<GmailIntegrationStatus | null>(null)
  const [claudeStatus, setClaudeStatus] = useState<ClaudeIntegrationStatus | null>(null)
  const [claudeKey, setClaudeKey] = useState('')
  const [modalProvider, setModalProvider] = useState<string | null>(null)
  const [slackStatus, setSlackStatus] = useState<SlackIntegrationStatus | null>(null)
  const [sfStatus, setSfStatus] = useState<SalesforceStatus | null>(null)
  const [integrationError, setIntegrationError] = useState<string | null>(null)
  const [loadingIntegration, setLoadingIntegration] = useState(false)
  const [claudeSkills, setClaudeSkills] = useState<ClaudeSkill[]>([])
  const [skillsConnected, setSkillsConnected] = useState(true)
  const [skillError, setSkillError] = useState<string | null>(null)
  const [savingSkill, setSavingSkill] = useState(false)

  const { sessionId } = useSession()
  const { has, isAdmin } = useFlags()

  const loadIntegrationStatus = async () => {
    try {
      setLoadingIntegration(true)
      setIntegrationError(null)
      const data = await getIntegrationsStatus(sessionId ?? '')
      setGmail(data.gmail)
      setClaudeStatus(data.claude)
      setSlackStatus(data.slack)
      setSfStatus(await getSalesforceStatus(sessionId ?? ''))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load integrations'
      setIntegrationError(message)
    } finally {
      setLoadingIntegration(false)
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void loadIntegrationStatus(), 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadClaudeSkills = async () => {
    try {
      setSkillError(null)
      const { skills, connected } = await listClaudeSkills(sessionId ?? '')
      setClaudeSkills(skills)
      setSkillsConnected(connected)
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : 'Failed to load skills')
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => void loadClaudeSkills(), 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connectClaudeKey = async () => {
    if (!claudeKey.trim()) return
    try {
      setIntegrationError(null)
      await connectClaude(sessionId ?? '', claudeKey.trim())
      setClaudeKey('')
      await loadIntegrationStatus()
      setModalProvider(null)
    } catch (err) {
      setIntegrationError(err instanceof Error ? err.message : 'Failed to connect Claude')
    }
  }

  const disconnectClaudeKey = async () => {
    try {
      setIntegrationError(null)
      await disconnectClaude(sessionId ?? '')
      await loadIntegrationStatus()
      setModalProvider(null)
    } catch (err) {
      setIntegrationError(err instanceof Error ? err.message : 'Failed to disconnect Claude')
    }
  }

  const submitSkill = async () => {
    if (!name.trim() || !instructions.trim()) return
    try {
      setSkillError(null)
      setSavingSkill(true)
      await createClaudeSkill(sessionId ?? '', {
        displayTitle: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        category,
      })
      setName('')
      setDescription('')
      setInstructions('')
      await loadClaudeSkills()
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : 'Failed to create skill')
    } finally {
      setSavingSkill(false)
    }
  }

  const removeSkill = async (id: string) => {
    try {
      setSkillError(null)
      await deleteClaudeSkill(sessionId ?? '', id)
      setClaudeSkills((cs) => cs.filter((s) => s.id !== id))
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : 'Failed to delete skill')
    }
  }

  const connectSlack = async () => {
    try {
      setIntegrationError(null)
      const url = await startSlackConnect()
      window.location.assign(url)
    } catch (err) {
      setIntegrationError(err instanceof Error ? err.message : 'Failed to start Slack connection')
    }
  }

  const disconnectSlackAccount = async () => {
    try {
      setIntegrationError(null)
      await disconnectSlack()
      await loadIntegrationStatus()
    } catch (err) {
      setIntegrationError(err instanceof Error ? err.message : 'Failed to disconnect Slack')
    }
  }

  type Tile = {
    key: string
    name: string
    color: string
    connected: boolean
    details: string[]
    action?: { label: string; onClick: () => void; danger?: boolean }
  }

  const sfPrimary = sfStatus?.accounts?.[0]
  const integrationTiles: Tile[] = [
    {
      key: 'claude',
      name: 'Claude',
      color: '#D97757',
      connected: claudeStatus?.status === 'connected',
      details:
        claudeStatus?.status === 'connected'
          ? [claudeStatus.accountLabel ?? 'Your API key', `Model: ${claudeStatus.model}`]
          : claudeStatus?.platformKeyAvailable
            ? ['Click to connect your own key (shared key in use)']
            : ['Click to connect your Anthropic API key'],
    },
    {
      key: 'gmail',
      name: 'Gmail',
      color: '#EA4335',
      connected: gmail?.status === 'connected',
      details:
        gmail?.status === 'connected'
          ? [
              gmail.defaultAccountEmail ?? '',
              `${gmail.accounts?.length ?? 0} account(s) · ${gmail.userDomain ?? ''}`,
            ]
          : ['Sign in or connect an account'],
    },
    {
      key: 'slack',
      name: 'Slack',
      color: '#4A154B',
      connected: slackStatus?.status === 'connected',
      details:
        slackStatus?.status === 'connected'
          ? [slackStatus.teamName ?? 'Connected workspace', `Signed in as ${slackStatus.authedUserId ?? 'user'}`]
          : slackStatus?.available
            ? ['Click Connect to authorize']
            : ['Add SLACK_CLIENT_ID on the server'],
      action:
        slackStatus?.status === 'connected'
          ? { label: 'Disconnect', onClick: disconnectSlackAccount, danger: true }
          : slackStatus?.available
            ? { label: 'Connect', onClick: connectSlack }
            : undefined,
    },
    {
      key: 'clickup',
      name: 'ClickUp',
      color: '#7B68EE',
      connected: false,
      details: ['Not yet available'],
    },
    {
      key: 'salesforce',
      name: 'Salesforce',
      color: '#00A1E0',
      connected: sfStatus?.status === 'connected',
      details:
        sfStatus?.status === 'connected' && sfPrimary
          ? [sfPrimary.username, `Org ${sfPrimary.orgId}`]
          : ['Not connected'],
    },
  ]

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Skills and immutable approval log</div>
        </div>
      </header>

      <div className="settings-tabs">
        <button
          type="button"
          className={tab === 'skills' ? 'btn btn-primary' : 'btn btn-ghost'}
          onClick={() => setTab('skills')}
        >
          Skills
        </button>
        <button
          type="button"
          className={tab === 'approvals' ? 'btn btn-primary' : 'btn btn-ghost'}
          onClick={() => setTab('approvals')}
        >
          Approval log
        </button>
        <button
          type="button"
          className={tab === 'integrations' ? 'btn btn-primary' : 'btn btn-ghost'}
          onClick={() => setTab('integrations')}
        >
          Integrations
        </button>
        {isAdmin ? (
          <button
            type="button"
            className={tab === 'admin' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab('admin')}
          >
            Admin
          </button>
        ) : null}
      </div>

      {tab === 'skills' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {skillError ? <div style={{ color: '#b91c1c', fontSize: 13 }}>{skillError}</div> : null}

          <section className="panel" style={{ padding: 12 }}>
            <h3 style={{ marginBottom: 4 }}>Build a custom Claude skill</h3>
            <p style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
              Saved as a real, versioned Agent Skill on your connected Claude workspace.
            </p>
            {skillsConnected ? null : (
              <div style={{ color: '#b45309', fontSize: 13, marginBottom: 8 }}>
                Connect Claude in the Integrations tab to build skills.
              </div>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Skill title"
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as SkillCategory)}
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}
              >
                <option value="email">Email</option>
                <option value="slack">Slack</option>
                <option value="salesforce">Salesforce</option>
              </select>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (when Claude should use this skill)"
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}
              />
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Instructions (becomes the SKILL.md body)"
                rows={4}
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={savingSkill || !skillsConnected}
                  onClick={() => void submitSkill()}
                >
                  {savingSkill ? 'Saving…' : 'Create skill on Claude'}
                </button>
              </div>
            </div>
          </section>

          <section className="panel" style={{ padding: 12 }}>
            <h3 style={{ marginBottom: 4 }}>Your Claude skills</h3>
            <p style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
              Custom skills you've built. The summary is the description Claude reads to decide when to use the skill.
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {claudeSkills.map((skill) => (
                <div
                  key={skill.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: 12,
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{skill.displayTitle}</strong>
                    <span className="badge" style={{ background: '#ecfdf5', color: '#047857' }}>
                      custom
                    </span>
                  </div>
                  <div style={{ color: '#475569', fontSize: 13 }}>
                    {skill.description || <em style={{ color: '#94a3b8' }}>No description provided.</em>}
                  </div>
                  <dl
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      gap: '2px 10px',
                      margin: 0,
                      fontSize: 12,
                      color: '#64748b',
                    }}
                  >
                    <dt style={{ color: '#94a3b8' }}>Skill name</dt>
                    <dd style={{ margin: 0 }}><code>{skill.name || '—'}</code></dd>
                    <dt style={{ color: '#94a3b8' }}>Skill ID</dt>
                    <dd style={{ margin: 0 }}><code>{skill.id}</code></dd>
                    <dt style={{ color: '#94a3b8' }}>Version</dt>
                    <dd style={{ margin: 0 }}><code>{skill.latestVersion}</code></dd>
                    <dt style={{ color: '#94a3b8' }}>Updated</dt>
                    <dd style={{ margin: 0 }}>{new Date(skill.updatedAt).toLocaleString()}</dd>
                  </dl>
                  <div className="skill-actions">
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void removeSkill(skill.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {claudeSkills.length === 0 && skillsConnected ? (
                <div style={{ color: '#64748b', fontSize: 13 }}>No custom skills yet.</div>
              ) : null}
            </div>
          </section>

          <section className="panel" style={{ padding: 12 }}>
            <h3 style={{ marginBottom: 4 }}>Base skills</h3>
            <p style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
              Built into Relay and always on. These run automatically on incoming work.
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {skillsStore.baseSkills.map((skill) => (
                <div
                  key={skill.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: 12,
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{skill.name}</strong>
                    <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }}>
                      {skill.category}
                    </span>
                  </div>
                  <div style={{ color: '#475569', fontSize: 13 }}>{skill.description}</div>
                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: 12, color: '#2563eb' }}>
                      What this skill does
                    </summary>
                    <p style={{ color: '#64748b', fontSize: 13, marginTop: 6, whiteSpace: 'pre-wrap' }}>
                      {skill.instructions}
                    </p>
                  </details>
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>Inherited base skill (read-only)</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : tab === 'approvals' ? (
        <ApprovalLogView log={approvalsStore.log} />
      ) : tab === 'integrations' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <section className="panel" style={{ padding: 12 }}>
            <h3 style={{ marginBottom: 8 }}>Connected apps</h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 10,
              }}
            >
              {integrationTiles
                .filter((tile) => tile.key !== 'slack' || has('slack_integration'))
                .map((tile) => (
                <div
                  key={tile.key}
                  onClick={tile.key === 'claude' ? () => setModalProvider('claude') : undefined}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: 12,
                    display: 'grid',
                    gap: 8,
                    background: '#fff',
                    cursor: tile.key === 'claude' ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: tile.color,
                          color: '#fff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        {tile.name[0]}
                      </span>
                      <strong>{tile.name}</strong>
                    </div>
                    <span
                      className="badge"
                      style={
                        tile.connected
                          ? { background: '#dcfce7', color: '#166534' }
                          : { background: '#f1f5f9', color: '#64748b' }
                      }
                    >
                      {tile.connected ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gap: 2 }}>
                    {tile.details.filter(Boolean).map((d, i) => (
                      <div key={i} style={{ fontSize: 12, color: tile.connected ? '#334155' : '#94a3b8' }}>
                        {d}
                      </div>
                    ))}
                  </div>
                  {tile.action ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className={tile.action.danger ? 'btn btn-danger' : 'btn btn-primary'}
                        onClick={tile.action.onClick}
                      >
                        {tile.action.label}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="panel" style={{ padding: 12, display: 'grid', gap: 10 }}>
            <h3>Gmail</h3>
          <div style={{ color: '#64748b', fontSize: 13 }}>
            Your login account is automatically added for Email Skill usage. You can connect extra Gmail
            accounts and choose which one the Email Skill uses by default.
          </div>

          {integrationError ? (
            <div style={{ color: '#b91c1c', fontSize: 13 }}>{integrationError}</div>
          ) : null}

          <div style={{ fontSize: 13 }}>
            Status: <strong>{gmail?.status ?? (loadingIntegration ? 'loading...' : 'unknown')}</strong>
          </div>
          {gmail?.defaultAccountEmail ? (
            <div style={{ fontSize: 13, color: '#334155' }}>
              Email Skill default account: <strong>{gmail.defaultAccountEmail}</strong>
            </div>
          ) : null}

          <div style={{ display: 'grid', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>Connected Gmail accounts</strong>
            {gmail?.accounts?.length ? (
              gmail.accounts.map((account) => {
                const isDefault = gmail.defaultAccountEmail === account.accountEmail
                return (
                  <div
                    key={account.accountEmail}
                    style={{
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: 10,
                      display: 'grid',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{account.accountEmail}</div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>
                          Source: {account.source === 'auth-login' ? 'Login account (auto-added)' : 'Connected Gmail account'}
                        </div>
                      </div>
                      {isDefault ? (
                        <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>
                          Default
                        </span>
                      ) : null}
                    </div>

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      {!isDefault ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={async () => {
                            try {
                              setIntegrationError(null)
                              await setDefaultGmailAccount(account.accountEmail)
                              await loadIntegrationStatus()
                            } catch (err) {
                              const message =
                                err instanceof Error ? err.message : 'Failed to set default Gmail account'
                              setIntegrationError(message)
                            }
                          }}
                        >
                          Use for Email Skill
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={async () => {
                          try {
                            setIntegrationError(null)
                            await disconnectGmail(account.accountEmail)
                            await loadIntegrationStatus()
                          } catch (err) {
                            const message =
                              err instanceof Error ? err.message : 'Failed to disconnect Gmail account'
                            setIntegrationError(message)
                          }
                        }}
                      >
                        Remove account
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <div style={{ color: '#64748b', fontSize: 13 }}>
                No Gmail accounts are linked yet. Sign in or connect one below.
              </div>
            )}
          </div>

          <div className="integration-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                try {
                  setIntegrationError(null)
                  const authUrl = await startGmailConnect()
                  window.location.href = authUrl
                } catch (err) {
                  const message = err instanceof Error ? err.message : 'Failed to start Gmail connection'
                  setIntegrationError(message)
                }
              }}
            >
              Connect Gmail
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                try {
                  setIntegrationError(null)
                  await disconnectGmail()
                  await loadIntegrationStatus()
                } catch (err) {
                  const message = err instanceof Error ? err.message : 'Failed to disconnect Gmail'
                  setIntegrationError(message)
                }
              }}
            >
              Disconnect all
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={loadIntegrationStatus}
            >
              Refresh
            </button>
          </div>
        </section>

        {modalProvider === 'claude' ? (
          <div
            onClick={() => setModalProvider(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15,23,42,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 50,
              padding: 16,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="panel"
              style={{ width: 'min(460px, 94vw)', padding: 20, display: 'grid', gap: 12, background: '#fff', borderRadius: 12 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: '#D97757',
                      color: '#fff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    C
                  </span>
                  <h3 style={{ margin: 0 }}>Connect Claude</h3>
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => setModalProvider(null)}>
                  ✕
                </button>
              </div>

              {integrationError ? (
                <div style={{ color: '#b91c1c', fontSize: 13 }}>{integrationError}</div>
              ) : null}

              {claudeStatus?.status === 'connected' ? (
                <>
                  <div style={{ fontSize: 13, color: '#334155' }}>
                    Connected with <strong>{claudeStatus.accountLabel}</strong>. Your key is saved to your
                    account and reused automatically every time you log in.
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" className="btn btn-ghost" onClick={() => setModalProvider(null)}>
                      Close
                    </button>
                    <button type="button" className="btn btn-danger" onClick={disconnectClaudeKey}>
                      Disconnect
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>
                    Paste your Anthropic API key. It's stored to your account and reused automatically on
                    every login.
                  </p>
                  <input
                    type="password"
                    value={claudeKey}
                    onChange={(e) => setClaudeKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void connectClaudeKey()
                      }
                    }}
                    placeholder="sk-ant-…"
                    autoFocus
                    style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}
                  />
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, color: '#2563eb' }}
                  >
                    Get an API key from the Anthropic Console →
                  </a>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" className="btn btn-ghost" onClick={() => setModalProvider(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-primary" onClick={connectClaudeKey}>
                      Save
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
        </div>
      ) : (
        <AdminPanel />
      )}
    </div>
  )
}
