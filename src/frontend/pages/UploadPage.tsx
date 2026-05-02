import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { uploadPictures } from '../api/pictures'
import PageCard from '../components/PageCard'
import StatusMessage from '../components/StatusMessage'
import UploadForm from '../components/UploadForm'
import { useQueryParam } from '../hooks/useQueryParam'
import AppShell from '../layouts/AppShell'

export default function UploadPage() {
  const navigate = useNavigate()
  const selectedParty = useQueryParam('party') ?? 'myParty'
  const [error, setError] = useState<string | null>(null)

  const handleUpload = async (files: FileList) => {
    setError(null)
    try {
      await uploadPictures(selectedParty, files)
    } catch {
      setError("L'envoi a échoué. Veuillez réessayer.")
      throw new Error('Upload failed')
    }
    navigate('/upload/confirmation')
  }

  return (
    <AppShell>
      <PageCard
        title="Envoyer des photos"
        subtitle="Sélectionnez vos images puis validez l'envoi."
      >
        <UploadForm onUpload={handleUpload} />
        {error ? <StatusMessage type="error" message={error} /> : null}
      </PageCard>
      <div className="position-fixed bottom-0 end-0 m-3">
        <Link to="/login" className="btn btn-outline-secondary btn-sm">
          Administration
        </Link>
      </div>
    </AppShell>
  )
}
