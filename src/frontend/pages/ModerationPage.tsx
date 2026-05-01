import ModerationGallery from '../components/ModerationGallery'
import ModerationToolbar from '../components/ModerationToolbar'
import { useModerationPictures } from '../features/useModerationPictures'

export default function ModerationPage() {
  const { pictures, loading, error, toggleStatus, removePicture } = useModerationPictures()

  return (
    <div className="container py-4">
      <ModerationToolbar />
      {loading ? <p>Chargement...</p> : null}
      {error ? <p className="status-message error">{error}</p> : null}
      <ModerationGallery pictures={pictures} onToggle={toggleStatus} onDelete={removePicture} />
    </div>
  )
}
