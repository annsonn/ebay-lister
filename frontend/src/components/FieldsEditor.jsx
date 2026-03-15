import { useRef } from 'react'

const FIELD_TYPES = ['text', 'select', 'bool', 'number']

export function FieldsEditor({ fields = [], onChange }) {
  const dragIdx = useRef(null)

  function update(i, key, val) {
    const next = fields.map((f, idx) => idx === i ? { ...f, [key]: val } : f)
    onChange(next)
  }

  function remove(i) {
    onChange(fields.filter((_, idx) => idx !== i))
  }

  function add() {
    onChange([...fields, {
      key: '', label: '', ebay_csv_col: '', type: 'text',
      required: false, recommended: false, in_title: false,
      title_order: fields.length + 1, options: null, default: null,
      mono: false, hint: '', title_suffix: null, title_wrap: null, in_price_search: false,
    }])
  }

  function onDragStart(i) { dragIdx.current = i }
  function onDragOver(e, i) {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    const next = [...fields]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(i, 0, moved)
    dragIdx.current = i
    onChange(next)
  }
  function onDrop() { dragIdx.current = null }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {fields.map((f, i) => (
        <div
          key={i}
          draggable
          onDragStart={() => onDragStart(i)}
          onDragOver={(e) => onDragOver(e, i)}
          onDrop={onDrop}
          style={{
            display: 'grid',
            gridTemplateColumns: '20px 120px 120px 100px 140px auto auto auto auto 32px',
            gap: 6,
            alignItems: 'center',
            padding: '8px 10px',
            background: 'var(--surface2)',
            borderRadius: 6,
            border: '1px solid var(--border)',
            cursor: 'grab',
          }}
        >
          <span style={{ color: 'var(--text3)', cursor: 'grab' }}>⋮⋮</span>
          <input className="field-input mono" style={{ fontSize: 11 }} placeholder="key" value={f.key} onChange={(e) => update(i, 'key', e.target.value)} />
          <input className="field-input" style={{ fontSize: 11 }} placeholder="label" value={f.label} onChange={(e) => update(i, 'label', e.target.value)} />
          <select className="field-input" style={{ fontSize: 11 }} value={f.type} onChange={(e) => update(i, 'type', e.target.value)}>
            {FIELD_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input className="field-input mono" style={{ fontSize: 11 }} placeholder="C: Column" value={f.ebay_csv_col || ''} onChange={(e) => update(i, 'ebay_csv_col', e.target.value)} />
          <label style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={!!f.required} onChange={(e) => update(i, 'required', e.target.checked)} /> REQ
          </label>
          <label style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={!!f.recommended} onChange={(e) => update(i, 'recommended', e.target.checked)} /> REC
          </label>
          <label style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={!!f.in_title} onChange={(e) => update(i, 'in_title', e.target.checked)} /> Title
          </label>
          <button className="btn btn-sm btn-red" style={{ padding: '2px 6px', fontSize: 13 }} onClick={() => remove(i)}>×</button>
        </div>
      ))}
      <button className="btn btn-outline btn-sm" onClick={add} style={{ alignSelf: 'flex-start' }}>+ Add Field</button>
    </div>
  )
}
