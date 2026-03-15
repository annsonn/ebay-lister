import { useEffect } from 'react'
import { api } from '../lib/api'

export function PhotoStrip({ photos = [], activeIndex, onSelect }) {
  useEffect(() => {
    if (photos.length > 0 && activeIndex === undefined) {
      onSelect?.(0)
    }
  }, [photos])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 64 }}>
      {photos.map((photo, i) => (
        <button
          key={photo.id || i}
          onClick={() => onSelect?.(i)}
          style={{
            position: 'relative',
            width: 56,
            height: 56,
            borderRadius: 6,
            overflow: 'hidden',
            border: `2px solid ${i === activeIndex ? 'var(--gold)' : 'var(--border)'}`,
            padding: 0,
            cursor: 'pointer',
            background: 'var(--surface2)',
            flexShrink: 0,
          }}
        >
          <img
            src={api.photoUrl(photo.filename)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          {i === 0 && (
            <span style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'rgba(240,165,0,0.85)',
              color: '#000', fontSize: 8, fontWeight: 700,
              textAlign: 'center', padding: '1px 0', letterSpacing: '0.06em',
            }}>COVER</span>
          )}
        </button>
      ))}
    </div>
  )
}
