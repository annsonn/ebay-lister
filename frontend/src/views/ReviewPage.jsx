import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { ReviewPanel } from './ReviewPanel'

export function ReviewPage() {
  const { listingId } = useParams()
  const navigate = useNavigate()
  const [listing, setListing] = useState(null)
  const [photos, setPhotos] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const l = await api.getListing(listingId)
        setListing(l)
        const batch = await api.getBatch(l.batch_id)
        setPhotos(batch.photos || [])
        if (l.profile_id) {
          const p = await api.getProfile(l.profile_id)
          setProfile(p)
        }
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [listingId])

  if (loading) return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div className="spinner" /> Loading…
    </div>
  )

  if (error) return (
    <div style={{ padding: 32, color: 'var(--red)' }}>{error}</div>
  )

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link to="/dashboard" className="btn btn-outline btn-sm">← Dashboard</Link>
        <div style={{ fontFamily: 'Bebas Neue', fontSize: 17, color: 'var(--text2)' }}>REVIEW LISTING</div>
      </div>
      <ReviewPanel
        listing={listing}
        photos={photos}
        profile={profile}
        onApprove={() => navigate('/dashboard')}
        onReprocess={() => navigate('/dashboard')}
      />
    </div>
  )
}
