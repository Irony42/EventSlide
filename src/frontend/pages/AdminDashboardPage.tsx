import AdminAccountGrid from '../components/AdminAccountGrid'
import AdminActionGrid from '../components/AdminActionGrid'
import PageCard from '../components/PageCard'
import AppShell from '../layouts/AppShell'
import { Link } from 'react-router-dom'

export default function AdminDashboardPage() {
  return (
    <AppShell>
      <PageCard title="Administration">
        <AdminActionGrid />
        
        <div className="mt-4 pt-3 border-top border-secondary">
          <Link to="/admin/qrcode" className="btn btn-outline-info w-100 mb-4 d-flex align-items-center justify-content-center" style={{ height: '50px' }}>
            <span className="fs-5">🔲 Afficher le QR Code</span>
          </Link>
        </div>

        <h2 className="h5 text-center mb-3 mt-2">Compte et utilisateurs</h2>
        <AdminAccountGrid />
      </PageCard>
    </AppShell>
  )
}
