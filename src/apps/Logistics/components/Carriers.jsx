import { useEffect, useState } from 'react'
import { supabase } from '@portal/lib/supabase'
import LogisticsNav from './LogisticsNav.jsx'
import {
  pageWrap, card, thStyle, inputStyle,
  Spinner, Flash, useFlash, PageHeader, HoverBtn,
} from '../utils/ui.jsx'

// Carrier settings — claims email drives dispute emails; fuel levy % prices
// levy lines; cubic kg/m³ converts ShipStation dims to chargeable weight.
export default function Carriers() {
  const [carriers,      setCarriers]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [msg,           flash]            = useFlash()
  const [carrierEdits,  setCarrierEdits]  = useState({})
  const [savingCarrier, setSavingCarrier] = useState(null)

  const fetchAll = async () => {
    const { data } = await supabase.from('carriers').select('*').order('name')
    if (data) setCarriers(data)
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [])

  const cleanOf = (c) => ({
    name: c?.name ?? '', email: c?.email ?? '', claims_email: c?.claims_email ?? '',
    claims_cc: c?.claims_cc ?? '',
    fuel_levy_pct: c?.fuel_levy_pct != null ? String(c.fuel_levy_pct) : '',
    cubic_factor_kg_m3: c?.cubic_factor_kg_m3 != null ? String(c.cubic_factor_kg_m3) : '250',
    billing_frequency: c?.billing_frequency ?? '',
  })

  const getEdit = (id) => carrierEdits[id] ?? cleanOf(carriers.find(x => x.id === id))

  const updateEdit = (id, field, value) =>
    setCarrierEdits(prev => ({ ...prev, [id]: { ...getEdit(id), [field]: value } }))

  const saveCarrier = async (id) => {
    const edit = getEdit(id)
    if (!edit.name.trim()) { flash('err', 'Carrier name is required'); return }
    const levy  = parseFloat(edit.fuel_levy_pct)
    const cubic = parseFloat(edit.cubic_factor_kg_m3)
    setSavingCarrier(id)
    const { error } = await supabase.from('carriers').update({
      name:          edit.name.trim(),
      email:         edit.email.trim() || null,
      claims_email:  edit.claims_email.trim() || null,
      claims_cc:     edit.claims_cc.trim() || null,
      fuel_levy_pct: isNaN(levy) ? null : levy,
      cubic_factor_kg_m3: isNaN(cubic) ? 250 : cubic,
      billing_frequency: edit.billing_frequency || null,
    }).eq('id', id)
    setSavingCarrier(null)
    if (error) { flash('err', error.message); return }
    flash('ok', 'Carrier updated')
    setCarrierEdits(prev => { const next = { ...prev }; delete next[id]; return next })
    fetchAll()
  }

  const addCarrier = async () => {
    const { error } = await supabase.from('carriers').insert({ name: 'New carrier' })
    if (error) { flash('err', error.message); return }
    fetchAll()
  }

  if (loading) return <Spinner />

  return (
    <div style={pageWrap}>
      <PageHeader title="Carriers" subtitle="Claims contacts, fuel levy and cubic conversion per carrier">
        <HoverBtn onClick={addCarrier}>+ Add carrier</HoverBtn>
      </PageHeader>

      <LogisticsNav />
      <Flash msg={msg} />

      <div style={{ ...card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Name', 'Billing Email', 'Claims To', 'Claims CC', 'Fuel Levy %', 'Cubic kg/m³', 'Billing', ''].map((h, i) => (
                <th key={i} style={thStyle()}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {carriers.map(carrier => {
              const edit  = getEdit(carrier.id)
              const dirty = JSON.stringify(edit) !== JSON.stringify(cleanOf(carrier))
              const isSaving = savingCarrier === carrier.id
              return (
                <tr key={carrier.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <input value={edit.name} onChange={e => updateEdit(carrier.id, 'name', e.target.value)} style={{ ...inputStyle, width: '170px' }} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <input value={edit.email} onChange={e => updateEdit(carrier.id, 'email', e.target.value)} placeholder="billing@carrier.com" style={{ ...inputStyle, width: '200px' }} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <input value={edit.claims_email} onChange={e => updateEdit(carrier.id, 'claims_email', e.target.value)} placeholder="claims@x.com; billing@x.com" style={{ ...inputStyle, width: '200px' }} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <input value={edit.claims_cc} onChange={e => updateEdit(carrier.id, 'claims_cc', e.target.value)} placeholder="cc@x.com; cc2@x.com" style={{ ...inputStyle, width: '180px' }} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <input value={edit.fuel_levy_pct} onChange={e => updateEdit(carrier.id, 'fuel_levy_pct', e.target.value)} placeholder="e.g. 18.5" style={{ ...inputStyle, width: '90px' }} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <input value={edit.cubic_factor_kg_m3} onChange={e => updateEdit(carrier.id, 'cubic_factor_kg_m3', e.target.value)} placeholder="250" style={{ ...inputStyle, width: '80px' }} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <select value={edit.billing_frequency} onChange={e => updateEdit(carrier.id, 'billing_frequency', e.target.value)} style={{ ...inputStyle, width: '110px', cursor: 'pointer' }}>
                      <option value="">Not tracked</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    <HoverBtn onClick={() => saveCarrier(carrier.id)} disabled={!dirty || isSaving}>
                      {isSaving ? 'Saving…' : 'Save'}
                    </HoverBtn>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
