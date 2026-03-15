import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useBatches } from '../hooks/useBatches'
import { StatusBadge } from '../components/StatusBadge'
import { ReviewPanel } from './ReviewPanel'
import { api } from '../lib/api'

const FILTERS = ['all', 'needs_review', 'approved', 'error']

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function DashboardPage() {
  const { batches, loading, refresh } = useBatches()
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [profileCache, setProfileCache] = useState({})
  const [batchDetailCache, setBatchDetailCache] = useState({})

  const filtered = filter === 'all'
    ? batches
    : batches.filter((b) => b.listing_summary?.status === filter || b.status === filter)

  const approvedCount = batches.filter((b) => b.listing_summary?.status === 'approved').length

  const selected = batches.find((b) => b.id === selectedId)

  async function selectBatch(batch) {
    setSelectedId(batch.id)
    if (!batchDetailCache[batch.id]) {
      try {
        const detail = await api.getBatch(batch.id)
        setBatchDetailCache((prev) => ({ ...prev, [batch.id]: detail }))
        if (detail.listing?.profile_id && !profileCache[detail.listing.profile_id]) {
          const prof = await api.getProfile(detail.listing.profile_id)
          setProfileCache((prev) => ({ ...prev, [prof.id]: prof }))
        }
      } catch {}
    }
  }

  const selectedDetail = batchDetailCache[selectedId]
  const selectedProfile = selectedDetail?.listing?.profile_id ? profileCache[selectedDetail.listing.profile_id] : null

  function countFilter(f) {
    if (f === 'all') return batches.length
    return batches.filter((b) => b.listing_summary?.status === f || b.status === f).length
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Sidebar */}
      <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--surface)' }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'Bebas Neue', fontSize: 17, letterSpacing: '0.08em', color: 'var(--gold)' }}>EBAY LISTER</div>
          <Link to="/capture" className="btn btn-gold btn-sm">CAPTURE +</Link>
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? 'btn-gold' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => setFilter(f)}
            >
              {f.replace('_', ' ').toUpperCase()}
              <span style={{ marginLeft: 4, opacity: 0.7 }}>({countFilter(f)})</span>
            </button>
          ))}
        </div>

        {/* Queue list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 20, color: 'var(--text3)', textAlign: 'center' }}>Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 20, color: 'var(--text3)', textAlign: 'center', fontSize: 13 }}>No items</div>
          )}
          {filtered.map((batch) => {
            const ls = batch.listing_summary
            const label = ls?.title || batch.label || ls?.first_field_value || 'Identifying…'
            return (
              <button
                key={batch.id}
                onClick={() => selectBatch(batch)}
                style={{
                  width: '100%',
                  display: 'flex',
                  gap: 10,
                  padding: '10px 14px',
                  border: 'none',
                  borderLeft: `3px solid ${selectedId === batch.id ? 'var(--gold)' : 'transparent'}`,
                  background: selectedId === batch.id ? 'var(--surface2)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderBottom: '1px solid var(--border)',
                  transition: 'background 0.1s',
                }}
              >
                {batch.first_photo ? (
                  <img src={api.photoUrl(batch.first_photo)} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--surface2)', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>
                    {label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <StatusBadge status={ls?.status || batch.status} step={batch.step} />
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>{relativeTime(batch.created_at)}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{batches.length} items</span>
          <button className="btn btn-ghost btn-sm" onClick={refresh}>Refresh</button>
        </div>
      </div>

      {/* Main panel */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Top bar */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {approvedCount > 0 && (
              <span className="badge badge-approved">{approvedCount} approved</span>
            )}
            <button
              className="btn btn-gold"
              onClick={api.exportCSV}
              disabled={approvedCount === 0}
            >
              ↓ Export CSV
            </button>
          </div>
        </div>

        {/* Content */}
        {!selectedId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 40 }}>📋</span>
            <span>Select an item to review</span>
          </div>
        ) : !selectedDetail ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text2)' }}>
            <div className="spinner" /> Loading…
          </div>
        ) : (selected?.status === 'queued' || selected?.status === 'processing') ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <div className="spinner spinner-lg" />
            <div style={{ fontFamily: 'Bebas Neue', fontSize: 22, color: 'var(--text2)' }}>
              {selected.step || 'PROCESSING…'}
            </div>
          </div>
        ) : (selected?.listing_summary?.status === 'needs_review' || selectedDetail?.listing?.status === 'needs_review') ? (
          <ReviewPanel
            listing={selectedDetail.listing}
            photos={selectedDetail.photos || []}
            profile={selectedProfile}
            onApprove={() => { setBatchDetailCache((p) => { const n = {...p}; delete n[selectedId]; return n }); refresh() }}
            onReprocess={() => { setBatchDetailCache((p) => { const n = {...p}; delete n[selectedId]; return n }); refresh() }}
          />
        ) : (selected?.listing_summary?.status === 'error' || selectedDetail?.listing?.status === 'error') ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
            <span style={{ fontSize: 40 }}>⚠️</span>
            <div style={{ color: 'var(--red)', fontFamily: 'Bebas Neue', fontSize: 22 }}>PIPELINE ERROR</div>
            <div style={{ color: 'var(--text2)', fontSize: 13, textAlign: 'center', maxWidth: 400 }}>
              {selectedDetail?.listing?.error || selected?.step || 'Unknown error'}
            </div>
            <button className="btn btn-gold" onClick={async () => {
              if (selectedDetail?.listing?.id) {
                await api.reprocessListing(selectedDetail.listing.id)
                setBatchDetailCache((p) => { const n = {...p}; delete n[selectedId]; return n })
                refresh()
              }
            }}>Retry</button>
          </div>
        ) : selectedDetail?.listing?.status === 'approved' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
            <span style={{ fontSize: 40 }}>✓</span>
            <div style={{ color: 'var(--green)', fontFamily: 'Bebas Neue', fontSize: 26 }}>APPROVED</div>
            <div style={{ color: 'var(--text2)', fontSize: 14 }}>{selectedDetail.listing.title}</div>
            <div style={{ fontFamily: 'Bebas Neue', fontSize: 22, color: 'var(--gold)' }}>CA${selectedDetail.listing.price?.toFixed(2)}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
