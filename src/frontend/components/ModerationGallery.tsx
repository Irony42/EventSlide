import { Picture } from '../types'
import ModerationImageCard from './ModerationImageCard'

interface ModerationGalleryProps {
  pictures: Picture[]
  onToggle: (fileName: string, status: 'accepted' | 'rejected') => Promise<void>
  onDelete: (fileName: string) => Promise<void>
}

export default function ModerationGallery({ pictures, onToggle, onDelete }: ModerationGalleryProps) {
  return (
    <div id="images" className="moderation-grid">
      {pictures.map((picture) => (
        <ModerationImageCard
          key={picture.fileName}
          picture={picture}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
