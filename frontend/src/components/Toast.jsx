import { useEffect } from 'react'

export function Toast({ message, type = 'info', onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [onDone])

  const colors = {
    success: 'var(--green)',
    error: 'var(--red)',
    info: 'var(--blue)',
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 1000,
      background: 'var(--surface)',
      border: `1px solid ${colors[type]}`,
      borderRadius: 10,
      padding: '12px 18px',
      color: 'var(--text)',
      fontSize: 13,
      fontWeight: 500,
      maxWidth: 360,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      animation: 'slideUp 0.25s ease',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <span style={{ color: colors[type], fontSize: 16 }}>
        {type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}
      </span>
      {message}
    </div>
  )
}
