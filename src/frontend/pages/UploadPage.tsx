import { Link, useNavigate } from 'react-router-dom'
import PageCard from '../components/PageCard'
import UploadForm from '../components/UploadForm'
import AppShell from '../layouts/AppShell'

export default function UploadPage() {
  const navigate = useNavigate()

  const handleUpload = async (files: FileList) => {
    const data = new FormData()
    Array.from(files).forEach((file) => data.append('photos', file))
    const response = await fetch('/api/upload?partyname=myParty', {
      method: 'POST',
      body: data,
      credentials: 'include'
    })
    if (!response.ok) throw new Error('Upload failed')
    navigate('/upload/confirmation')
  }

  return (
    <AppShell>
      <PageCard
        title="Envoyer des photos"
        subtitle="Selectionnez vos images puis validez l'envoi."
      >
        <UploadForm onUpload={handleUpload} />
      </PageCard>
      <div className="position-fixed bottom-0 end-0 m-3">
        <Link to="/login" className="small text-secondary text-decoration-none">
          Administration
        </Link>
      </div>
    </AppShell>
  )
}
