export function FieldInput({
  label, value, onChange, field, modified, mono, multiline,
  type = 'text', required, recommended, fullWidth, span2,
  options, hint, children,
}) {
  return (
    <div className="field" style={{ gridColumn: span2 ? 'span 2' : undefined, width: fullWidth ? '100%' : undefined }}>
      <label className="field-label">
        {label}
        {required && <span className="badge badge-req">REQ</span>}
        {recommended && !required && <span className="badge badge-rec">REC</span>}
      </label>
      {children ? children : options ? (
        <select
          className={`field-input${mono ? ' mono' : ''}${modified ? ' modified' : ''}`}
          value={value ?? ''}
          onChange={(e) => onChange?.(field, e.target.value)}
        >
          {options.map((o) => (
            <option key={o} value={o}>{o || '— none —'}</option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          className={`field-input${mono ? ' mono' : ''}${modified ? ' modified' : ''}`}
          value={value ?? ''}
          onChange={(e) => onChange?.(field, e.target.value)}
          rows={3}
        />
      ) : (
        <input
          className={`field-input${mono ? ' mono' : ''}${modified ? ' modified' : ''}`}
          type={type}
          value={value ?? ''}
          onChange={(e) => onChange?.(field, e.target.value)}
        />
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}
