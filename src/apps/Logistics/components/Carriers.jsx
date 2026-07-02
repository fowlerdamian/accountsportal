import LogisticsNav from './LogisticsNav.jsx'
import TntSetup from './TntSetup.jsx'
import { pageWrap, PageHeader } from '../utils/ui.jsx'

// Logistics Settings page. Carrier records (claims emails, fuel levy, cubic
// factor, billing frequency, account number) still drive the engine and
// queries — they're just no longer edited here; values live in the DB.
export default function Carriers() {
  return (
    <div style={pageWrap}>
      <PageHeader title="Settings" subtitle="TNT invoice-query form setup" />
      <LogisticsNav />
      <TntSetup />
    </div>
  )
}
