import { Link } from 'react-router-dom'
import PageCard from '../components/PageCard'
import AppShell from '../layouts/AppShell'

export default function UploadConfirmationPage() {
  return (
    <AppShell>
      <PageCard
        title="Merci pour vos photos !"
        subtitle="L'envoi a bien fonctionne, vos photos apparaitront bientot dans la salle."
      >
        <Link to="/upload" className="btn btn-success w-100">
          Envoyer d'autres photos
        </Link>
      </PageCard>
    </AppShell>
  )
}
