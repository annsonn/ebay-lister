import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { ProfilePill } from '../components/ProfilePill'

export function CapturePage() {
  const [profiles, setProfiles] = useState([])
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [label, setLabel] = useState('')
  const [itemHint, setItemHint] = useState('')
  const [photos, setPhotos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [success, setSuccess] = useState(null)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    api.listProfiles().then((ps) => {
      setProfiles(ps)
      const def = ps.find((p) => p.is_default) || ps[0]
      if (def) setSelectedProfile(def)
    }).catch(console.error)
  }, [])

  function addFiles(files) {
    const arr = Array.from(files)
    setPhotos((prev) => {
      const combined = [...prev, ...arr]
      return combined.slice(0, 12)
    })
  }

  function removePhoto(i) {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function submit() {
    if (!photos.length) return
    setUploading(true)
    setError(null)
    const fd = new FormData()
    if (label) fd.append('label', label)
    if (itemHint) fd.append('item_hint', itemHint)
    if (selectedProfile) fd.append('profile_id', selectedProfile.id)
    photos.forEach((p) => fd.append('photos', p))
    try {
      const result = await api.createBatch(fd)
      setSuccess(result)
      setPhotos([])
      setLabel('')
      setItemHint('')
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  function reset() {
    setSuccess(null)
    setError(null)
    setPhotos([])
    setLabel('')
    setItemHint('')
  }

  return (
    <div style={{ minHeight: '100dvh', paddingBottom: 'env(safe-area-inset-bottom)', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'Bebas Neue', fontSize: 20, letterSpacing: '0.08em', color: 'var(--gold)' }}>EBAY LISTER / CAPTURE</div>
        <Link to="/dashboard" className="btn btn-outline btn-sm">QUEUE →</Link>
      </div>

      {/* Profile selector */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px', overflowX: 'auto', borderBottom: '1px solid var(--border)' }}>
        {profiles.map((p) => (
          <ProfilePill key={p.id} profile={p} selected={selectedProfile?.id === p.id} onClick={() => setSelectedProfile(p)} />
        ))}
      </div>

      {success ? (
        // Success state
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 }}>
          <div className="card" style={{ width: '100%', maxWidth: 400, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
            <div style={{ fontFamily: 'Bebas Neue', fontSize: 36, color: 'var(--green)', marginBottom: 8 }}>QUEUED!</div>
            <div style={{ color: 'var(--text2)', marginBottom: 4 }}>{success.photo_count} photo{success.photo_count !== 1 ? 's' : ''} uploaded</div>
            {label && <div style={{ color: 'var(--text3)', fontSize: 12 }}>{label}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', background: 'var(--gold-dim)', border: '1px solid var(--gold)', borderRadius: 10, color: 'var(--gold)', fontWeight: 500 }}>
            <div className="spinner spinner-sm" style={{ borderTopColor: 'var(--gold)' }} />
            AI is identifying…
          </div>
          <button className="btn btn-gold btn-lg" onClick={reset} style={{ width: '100%', maxWidth: 400 }}>Next Item</button>
          <Link to="/dashboard" style={{ color: 'var(--text2)', fontSize: 13 }}>View Queue →</Link>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, gap: 16 }}>
          {/* Item hint */}
          <div>
            <input
              className="field-input"
              style={{ fontSize: 16 }}
              placeholder="What is this? (e.g. 'Funko Pop Spider-Man #1')"
              value={itemHint}
              onChange={(e) => setItemHint(e.target.value)}
              disabled={uploading}
            />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, paddingLeft: 2 }}>
              Optional hint — helps the AI identify the item
            </div>
          </div>

          {/* Label */}
          <input
            className="field-input"
            style={{ fontSize: 16 }}
            placeholder="Internal label (e.g. 'Lot 42')"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={uploading}
          />

          {/* Error */}
          {error && (
            <div style={{ padding: '10px 14px', background: 'rgba(255,77,109,0.1)', border: '1px solid var(--red)', borderRadius: 8, color: 'var(--red)', fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Photo tips (when empty) */}
          {photos.length === 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div className="card-title" style={{ marginBottom: 10 }}>PHOTO TIPS</div>
              <ol style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--text2)', fontSize: 13 }}>
                <li>Front of box — full face visible</li>
                <li>Back of box — all text readable</li>
                <li>Top of box — box number (#XXX)</li>
                <li>Exclusive sticker (if any)</li>
                <li>Any condition issues</li>
              </ol>
            </div>
          )}

          {/* Photo grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {photos.map((file, i) => (
              <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: 'var(--surface2)' }}>
                <img src={URL.createObjectURL(file)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                {i === 0 && (
                  <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(240,165,0,0.9)', color: '#000', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, letterSpacing: '0.06em' }}>COVER</div>
                )}
                <button
                  onClick={() => removePhoto(i)}
                  disabled={uploading}
                  style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >×</button>
              </div>
            ))}
            {photos.length < 12 && (
              <label style={{ aspectRatio: '1', borderRadius: 8, border: '2px dashed var(--border2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: 6, color: 'var(--text3)', fontSize: 12 }}>
                <span style={{ fontSize: 28 }}>📷</span>
                <span>ADD</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={(e) => addFiles(e.target.files)}
                  disabled={uploading}
                />
              </label>
            )}
          </div>

          {/* Sticky submit */}
          <div style={{ position: 'sticky', bottom: 0, paddingTop: 8, paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <button
              className="btn btn-gold btn-lg"
              style={{ width: '100%' }}
              onClick={submit}
              disabled={photos.length === 0 || uploading}
            >
              {uploading ? (
                <><div className="spinner spinner-sm" style={{ borderTopColor: '#000' }} /> Uploading…</>
              ) : `↑ Submit ${photos.length} Photo${photos.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
