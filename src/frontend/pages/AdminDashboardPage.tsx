import AdminAccountGrid from '../components/AdminAccountGrid'
import AdminActionGrid from '../components/AdminActionGrid'
import PageCard from '../components/PageCard'
import AppShell from '../layouts/AppShell'

export default function AdminDashboardPage() {
  return (
    <AppShell>
      <PageCard title="Administration">
        <AdminActionGrid />
        <h2 className="h5 text-center mb-3">Compte et utilisateurs</h2>
        <AdminAccountGrid />
      </PageCard>
    </AppShell>
  )
}
