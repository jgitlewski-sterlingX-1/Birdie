import { useEffect, useState } from 'react'
import type { useSkills } from '../skillsStore'
import type { useApprovals } from '../approvalsStore'
import type { SkillCategory } from '../types'
import { useSession } from '../session'
import { ApprovalLogView } from '../components/ApprovalLogView'
import {
  disconnectGmail,
  getIntegrationsStatus,
  startGmailConnect,
  type GmailIntegrationStatus,
} from '../integrationsApi'

type Tab = 'skills' | 'approvals' | 'integrations'

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
  const [integrationError, setIntegrationError] = useState<string | null>(null)
  const [loadingIntegration, setLoadingIntegration] = useState(false)

  const { currentUser } = useSession()

  const loadIntegrationStatus = async () => {
    try {
      setLoadingIntegration(true)
      setIntegrationError(null)
      const data = await getIntegrationsStatus()
      setGmail(data.gmail)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load integrations'
      setIntegrationError(message)
    } finally {
      setLoadingIntegration(false)
    }
  }

  useEffect(() => {
    loadIntegrationStatus()
  }, [])

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
      ) : (
        <section className="panel" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <h3>Gmail</h3>
          <div style={{ color: '#64748b', fontSize: 13 }}>
            Connect your Gmail account for inbox sync and approval-gated draft creation.
          </div>

          {integrationError ? (
            <div style={{ color: '#b91c1c', fontSize: 13 }}>{integrationError}</div>
          ) : null}

          <div style={{ fontSize: 13 }}>
            Status: <strong>{gmail?.status ?? (loadingIntegration ? 'loading...' : 'unknown')}</strong>
          </div>
          {gmail?.accountEmail ? (
            <div style={{ fontSize: 13, color: '#334155' }}>Connected as: {gmail.accountEmail}</div>
          ) : null}

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
              Disconnect
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
      )}
    </div>
  )
}
