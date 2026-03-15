import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { PromptEditor } from '../components/PromptEditor'
import { FieldsEditor } from '../components/FieldsEditor'
import { ShippingSection } from '../components/ShippingSection'
import { Toast } from '../components/Toast'

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function SettingsPage() {
  const [tab, setTab] = useState('profiles')
  const [profiles, setProfiles] = useState([])
  const [selectedProfileId, setSelectedProfileId] = useState(null)
  const [editProfile, setEditProfile] = useState(null)
  const [settings, setSettings] = useState({})
  const [ollamaModels, setOllamaModels] = useState([])
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [lastBatchId, setLastBatchId] = useState(null)

  async function loadProfiles() {
    const ps = await api.listProfiles()
    setProfiles(ps)
  }

  useEffect(() => {
    loadProfiles().catch(console.error)
    api.getSettings().then(setSettings).catch(console.error)
    api.getOllamaModels().then((r) => setOllamaModels(r.models || [])).catch(console.error)
    // Get last batch id for prompt testing
    api.listBatches().then((bs) => {
      if (bs.length > 0) setLastBatchId(bs[0].id)
    }).catch(console.error)
  }, [])

  function selectProfile(p) {
    setSelectedProfileId(p.id)
    api.getProfile(p.id).then(setEditProfile).catch(console.error)
  }

  function updateEditField(key, val) {
    setEditProfile((prev) => ({ ...prev, [key]: val }))
  }

  async function saveProfile() {
    if (!editProfile) return
    setSaving(true)
    try {
      if (editProfile.id && profiles.find((p) => p.id === editProfile.id)) {
        await api.updateProfile(editProfile.id, editProfile)
        setToast({ message: 'Profile saved', type: 'success' })
      } else {
        const created = await api.createProfile(editProfile)
        setEditProfile(created)
      }
      await loadProfiles()
    } catch (e) {
      setToast({ message: e.message, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function deleteProfile(id) {
    if (!window.confirm('Delete this profile?')) return
    try {
      await api.deleteProfile(id)
      await loadProfiles()
      if (selectedProfileId === id) { setSelectedProfileId(null); setEditProfile(null) }
      setToast({ message: 'Deleted', type: 'success' })
    } catch (e) {
      setToast({ message: e.message, type: 'error' })
    }
  }

  async function duplicateProfile(id) {
    try {
      const copy = await api.duplicateProfile(id)
      await loadProfiles()
      setSelectedProfileId(copy.id)
      api.getProfile(copy.id).then(setEditProfile)
      setToast({ message: 'Duplicated', type: 'success' })
    } catch (e) {
      setToast({ message: e.message, type: 'error' })
    }
  }

  async function setDefault(id) {
    try {
      await api.updateProfile(id, { is_default: true })
      await loadProfiles()
    } catch (e) {
      setToast({ message: e.message, type: 'error' })
    }
  }

  async function saveSettings() {
    setSaving(true)
    try {
      await api.updateSettings(settings)
      setToast({ message: 'Settings saved', type: 'success' })
    } catch (e) {
      setToast({ message: e.message, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  function newProfile() {
    setSelectedProfileId(null)
    setEditProfile({
      name: 'New Profile',
      slug: 'new-profile',
      icon: '📦',
      is_default: false,
      ebay_category_id: '',
      ebay_brand: '',
      ebay_item_type: '',
      ebay_product_line: '',
      ebay_condition_default: 'Used',
      prompt_ocr: '',
      prompt_struct: '',
      prompt_fields: [],
      price_search_template: '',
      default_weight_g: 450,
      default_length_cm: 23,
      default_width_cm: 17,
      default_depth_cm: 12,
      shipping_defaults: {},
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontFamily: 'Bebas Neue', fontSize: 20, color: 'var(--gold)' }}>EBAY LISTER / SETTINGS</div>
        {['profiles', 'general'].map((t) => (
          <button key={t} className={`btn btn-sm ${tab === t ? 'btn-gold' : 'btn-outline'}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'profiles' && (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Profile list */}
          <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', background: 'var(--surface)' }}>
            {profiles.map((p) => (
              <div
                key={p.id}
                onClick={() => selectProfile(p)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: `3px solid ${selectedProfileId === p.id ? 'var(--gold)' : 'transparent'}`,
                  background: selectedProfileId === p.id ? 'var(--surface2)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 18 }}>{p.icon}</span>
                  <span style={{ fontWeight: 500 }}>{p.name}</span>
                  {p.is_default && <span className="badge badge-approved" style={{ fontSize: 9 }}>DEFAULT</span>}
                  {p.is_builtin && <span className="badge badge-queued" style={{ fontSize: 9 }}>BUILT-IN</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{p.listing_count} listings · {p.field_count} fields</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  {!p.is_default && <button className="btn btn-sm btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={(e) => { e.stopPropagation(); setDefault(p.id) }}>Set Default</button>}
                  <button className="btn btn-sm btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={(e) => { e.stopPropagation(); duplicateProfile(p.id) }}>Duplicate</button>
                  {!p.is_builtin && <button className="btn btn-sm btn-red" style={{ fontSize: 10, padding: '2px 6px' }} onClick={(e) => { e.stopPropagation(); deleteProfile(p.id) }}>Delete</button>}
                </div>
              </div>
            ))}
            <div style={{ padding: 12 }}>
              <button className="btn btn-outline btn-sm" style={{ width: '100%' }} onClick={newProfile}>+ New Profile</button>
            </div>
          </div>

          {/* Profile editor */}
          {editProfile && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Basic */}
              <div className="card">
                <div className="card-header"><span className="card-title">BASIC INFO</span></div>
                <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                  <div className="field">
                    <label className="field-label">Name</label>
                    <input className="field-input" value={editProfile.name || ''} onChange={(e) => { updateEditField('name', e.target.value); if (!editProfile.id) updateEditField('slug', slugify(e.target.value)) }} />
                  </div>
                  <div className="field">
                    <label className="field-label">Slug</label>
                    <input className="field-input mono" value={editProfile.slug || ''} onChange={(e) => updateEditField('slug', e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="field-label">Icon (emoji)</label>
                    <input className="field-input" value={editProfile.icon || ''} onChange={(e) => updateEditField('icon', e.target.value)} style={{ fontSize: 20 }} />
                  </div>
                  <div className="field">
                    <label className="field-label">eBay Category ID</label>
                    <input className="field-input mono" value={editProfile.ebay_category_id || ''} onChange={(e) => updateEditField('ebay_category_id', e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="field-label">Brand</label>
                    <input className="field-input" value={editProfile.ebay_brand || ''} onChange={(e) => updateEditField('ebay_brand', e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="field-label">Product Line</label>
                    <input className="field-input" value={editProfile.ebay_product_line || ''} onChange={(e) => updateEditField('ebay_product_line', e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="field-label">Item Type</label>
                    <input className="field-input" value={editProfile.ebay_item_type || ''} onChange={(e) => updateEditField('ebay_item_type', e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="field-label">Default Condition</label>
                    <select className="field-input" value={editProfile.ebay_condition_default || 'Used'} onChange={(e) => updateEditField('ebay_condition_default', e.target.value)}>
                      <option>New</option>
                      <option>Used</option>
                      <option>Not specified</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label">
                      <input type="checkbox" checked={!!editProfile.is_default} onChange={(e) => updateEditField('is_default', e.target.checked)} style={{ marginRight: 4 }} />
                      Set as Default
                    </label>
                  </div>
                </div>
              </div>

              {/* Prompts */}
              <div className="card">
                <div className="card-header"><span className="card-title">PROMPTS</span></div>
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <PromptEditor
                    label="Pass 1 — OCR Prompt"
                    value={editProfile.prompt_ocr}
                    onChange={(v) => updateEditField('prompt_ocr', v)}
                    profileId={editProfile.id}
                    batchId={lastBatchId}
                  />
                  <PromptEditor
                    label="Pass 2 — Structured Prompt"
                    value={editProfile.prompt_struct}
                    onChange={(v) => updateEditField('prompt_struct', v)}
                    profileId={editProfile.id}
                    batchId={lastBatchId}
                  />
                </div>
              </div>

              {/* Fields */}
              <div className="card">
                <div className="card-header"><span className="card-title">FIELDS</span></div>
                <div style={{ padding: 16 }}>
                  <FieldsEditor fields={editProfile.prompt_fields || []} onChange={(f) => updateEditField('prompt_fields', f)} />
                </div>
              </div>

              {/* Defaults */}
              <div className="card">
                <div className="card-header"><span className="card-title">PACKAGE DEFAULTS</span></div>
                <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {[
                    { key: 'default_length_cm', label: 'Length (cm)' },
                    { key: 'default_width_cm', label: 'Width (cm)' },
                    { key: 'default_depth_cm', label: 'Depth (cm)' },
                    { key: 'default_weight_g', label: 'Weight (g)' },
                  ].map(({ key, label }) => (
                    <div key={key} className="field">
                      <label className="field-label">{label}</label>
                      <input className="field-input" type="number" value={editProfile[key] || ''} onChange={(e) => updateEditField(key, parseInt(e.target.value) || 0)} />
                    </div>
                  ))}
                </div>
                <div style={{ padding: '0 16px 16px' }}>
                  <div className="field">
                    <label className="field-label">Price Search Template</label>
                    <input className="field-input mono" value={editProfile.price_search_template || ''} onChange={(e) => updateEditField('price_search_template', e.target.value)} placeholder="{field_key} tokens interpolated" />
                  </div>
                </div>
              </div>

              {/* Shipping defaults */}
              <div className="card">
                <div className="card-header"><span className="card-title">SHIPPING DEFAULTS</span></div>
                <ShippingSection shipping={editProfile.shipping_defaults || {}} onChange={(v) => updateEditField('shipping_defaults', v)} />
              </div>

              {/* Save/Cancel */}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-gold btn-lg" onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</button>
                <button className="btn btn-outline" onClick={() => { setSelectedProfileId(null); setEditProfile(null) }}>Cancel</button>
              </div>
            </div>
          )}
          {!editProfile && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
              Select a profile to edit
            </div>
          )}
        </div>
      )}

      {tab === 'general' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 32, maxWidth: 600 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="field">
              <label className="field-label">Ollama Model</label>
              {ollamaModels.length > 0 ? (
                <select className="field-input" value={settings.ollama_model || ''} onChange={(e) => setSettings((p) => ({ ...p, ollama_model: e.target.value }))}>
                  {ollamaModels.map((m) => <option key={m}>{m}</option>)}
                </select>
              ) : (
                <input className="field-input mono" value={settings.ollama_model || ''} onChange={(e) => setSettings((p) => ({ ...p, ollama_model: e.target.value }))} placeholder="qwen2.5vl:7b" />
              )}
            </div>
            <div className="field">
              <label className="field-label">Ollama Host</label>
              <input className="field-input mono" value={settings.ollama_host || ''} onChange={(e) => setSettings((p) => ({ ...p, ollama_host: e.target.value }))} placeholder="http://ollama:11434" />
            </div>
            <div className="field">
              <label className="field-label">eBay App ID</label>
              <input className="field-input mono" value={settings.ebay_app_id || ''} onChange={(e) => setSettings((p) => ({ ...p, ebay_app_id: e.target.value }))} />
            </div>
            <div className="field">
              <label className="field-label">eBay Client Secret</label>
              <input className="field-input mono" type="password" value={settings.ebay_client_secret || ''} onChange={(e) => setSettings((p) => ({ ...p, ebay_client_secret: e.target.value }))} />
            </div>
            <div className="field">
              <label className="field-label">Server Base URL</label>
              <input className="field-input mono" value={settings.server_base_url || ''} onChange={(e) => setSettings((p) => ({ ...p, server_base_url: e.target.value }))} placeholder="http://192.168.1.x:8000" />
              <span className="field-hint">Used for photo URLs in eBay CSV export</span>
            </div>
            <button className="btn btn-gold btn-lg" onClick={saveSettings} disabled={saving} style={{ alignSelf: 'flex-start' }}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
