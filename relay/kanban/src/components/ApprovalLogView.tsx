import type { ApprovalLogEntry } from '../types'

export function ApprovalLogView({ log }: { log: ApprovalLogEntry[] }) {
  if (log.length === 0) {
    return <div className="panel" style={{ padding: 12 }}>No approvals yet.</div>
  }

  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', background: '#f8fafc' }}>
            <th style={{ padding: 10 }}>Time</th>
            <th style={{ padding: 10 }}>Card</th>
            <th style={{ padding: 10 }}>Action</th>
            <th style={{ padding: 10 }}>By</th>
            <th style={{ padding: 10 }}>External Ref</th>
          </tr>
        </thead>
        <tbody>
          {[...log]
            .reverse()
            .map((entry) => (
              <tr key={entry.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                <td style={{ padding: 10, fontSize: 12 }}>{new Date(entry.approvedAt).toLocaleString()}</td>
                <td style={{ padding: 10 }}>{entry.cardTitle}</td>
                <td style={{ padding: 10 }}>{entry.action}</td>
                <td style={{ padding: 10 }}>{entry.approvedByName}</td>
                <td style={{ padding: 10, fontSize: 12, color: '#64748b' }}>{entry.externalRef ?? '-'}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
