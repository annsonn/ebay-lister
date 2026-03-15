export function StatusBadge({ status, step }) {
  const map = {
    queued: { cls: 'badge-queued', label: 'QUEUED' },
    processing: { cls: 'badge-processing', label: step || 'PROCESSING' },
    needs_review: { cls: 'badge-needs_review', label: 'REVIEW' },
    approved: { cls: 'badge-approved', label: 'APPROVED' },
    error: { cls: 'badge-error', label: 'ERROR' },
    pending: { cls: 'badge-queued', label: 'PENDING' },
  }
  const info = map[status] || { cls: 'badge-queued', label: status?.toUpperCase() }
  return (
    <span className={`badge ${info.cls}`}>
      {status === 'processing' && <span className="pulse-dot" />}
      {info.label}
    </span>
  )
}
