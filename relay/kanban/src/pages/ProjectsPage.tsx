import { useMemo, useState } from 'react'
import type { useProjects } from '../projectsStore'
import type { useBoard } from '../store'

interface ProjectsPageProps {
  projectsStore: ReturnType<typeof useProjects>
  boardStore: ReturnType<typeof useBoard>
  onOpenCard: (id: string) => void
}

export function ProjectsPage({ projectsStore, boardStore, onOpenCard }: ProjectsPageProps) {
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')

  const { projects, addProject, deleteProject } = projectsStore
  const cards = Object.values(boardStore.board.cards)

  const cardsByProject = useMemo(() => {
    const map: Record<string, typeof cards> = {}
    for (const project of projects) map[project.id] = []
    for (const card of cards) {
      if (card.projectId && map[card.projectId]) map[card.projectId].push(card)
    }
    return map
  }, [projects, cards])

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="page-title">Projects</div>
          <div className="page-subtitle">Group cards by matter or initiative</div>
        </div>
      </header>

      <section className="panel" style={{ padding: 12, marginBottom: 12 }}>
        <div className="projects-form">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name"
            style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}
          />
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description"
            style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px' }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (!newName.trim()) return
              addProject(newName.trim(), newDescription.trim() || undefined)
              setNewName('')
              setNewDescription('')
            }}
          >
            Add project
          </button>
        </div>
      </section>

      <div style={{ display: 'grid', gap: 10 }}>
        {projects.map((project) => {
          const projectCards = cardsByProject[project.id] ?? []
          const done = projectCards.filter((c) => c.completed).length
          const total = projectCards.length || 1
          const progress = Math.round((done / total) * 100)

          return (
            <section key={project.id} className="panel" style={{ padding: 12 }}>
              <div className="project-row">
                <div>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: project.color }} />
                    {project.name}
                  </h3>
                  <p style={{ color: '#64748b', fontSize: 13 }}>{project.description ?? 'No description'}</p>
                </div>
                <button type="button" className="btn btn-danger" onClick={() => deleteProject(project.id)}>
                  Delete
                </button>
              </div>

              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <div style={{ height: 8, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: project.color }} />
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  {done} / {projectCards.length} done
                </div>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                {projectCards.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 13 }}>No cards assigned.</div>
                ) : (
                  projectCards.map((card) => (
                    <button
                      type="button"
                      key={card.id}
                      className="panel"
                      onClick={() => onOpenCard(card.id)}
                      style={{ textAlign: 'left', padding: 8 }}
                    >
                      {card.title}
                    </button>
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
