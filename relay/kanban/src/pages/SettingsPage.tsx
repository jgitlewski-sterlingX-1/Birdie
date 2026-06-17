import { useEffect, useState } from 'react'
import type { useSkills } from '../skillsStore'
import type { useApprovals } from '../approvalsStore'
import type { SkillCategory } from '../types'
import { useSession } from '../session'
import { ApprovalLogView } from '../components/ApprovalLogView'
import { AdminPanel } from '../components/AdminPanel'
import { useFlags } from '../flags'
import {
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
  const [slackStatus, setSlackStatus] = useState<SlackIntegrationStatus | null>(null)
  const [sfStatus, setSfStatus] = useState<SalesforceStatus | null>(null)
  const [integrationError, setIntegrationError] = useState<string | null>(null)
  const [loadingIntegration, setLoadingIntegration] = useState(false)

  const { currentUser, sessionId } = useSession()
  const { has, isAdmin } = useFlags()

  const loadIntegrationStatus = async () => {
    try {
      setLoadingIntegration(true)
      setIntegrationError(null)
      const data = await getIntegrationsStatus()
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
          ? [`Model: ${claudeStatus.model}`, 'Drafts replies · triages email']
          : ['Set ANTHROPIC_API_KEY on the server'],
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
          <section className="panel" style={{ padding: 12 }}>
            <h3 style={{ marginBottom: 8 }}>Create custom skill</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Skill name"
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
                placeholder="Description"
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}
              />
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Instructions"
                rows={4}
                style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (!name.trim() || !description.trim() || !instructions.trim()) return
                    skillsStore.addSkill(
                      name.trim(),
                      category,
                      description.trim(),
                      instructions.trim(),
                      currentUser.id
                    )
                    setName('')
                    setDescription('')
                    setInstructions('')
                  }}
                >
                  Add skill
                </button>
              </div>
            </div>
          </section>

          <section className="panel" style={{ padding: 12 }}>
            <h3 style={{ marginBottom: 8 }}>Skills</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {skillsStore.allSkills.map((skill) => (
                <div
                  key={skill.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: 10,
                    display: 'grid',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{skill.name}</strong>
                    <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }}>
                      {skill.kind}
                    </span>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 13 }}>{skill.description}</div>
                  <div className="skill-actions">
                    {skill.kind === 'custom' ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => skillsStore.toggleSkill(skill.id)}
                        >
                          {skill.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => skillsStore.deleteSkill(skill.id)}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <span style={{ color: '#64748b', fontSize: 12 }}>Inherited base skill (read-only)</span>
                    )}
                  </div>
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
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: 12,
                    display: 'grid',
                    gap: 8,
                    background: '#fff',
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
        </div>
      ) : (
        <AdminPanel />
      )}
    </div>
  )
}
