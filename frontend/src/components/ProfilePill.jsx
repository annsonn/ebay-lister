export function ProfilePill({ profile, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 14px',
        borderRadius: 20,
        border: `1px solid ${selected ? 'var(--gold)' : 'var(--border2)'}`,
        background: selected ? 'var(--gold-dim)' : 'transparent',
        color: selected ? 'var(--gold)' : 'var(--text2)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}
    >
      <span>{profile.icon}</span>
      <span>{profile.name}</span>
    </button>
  )
}
