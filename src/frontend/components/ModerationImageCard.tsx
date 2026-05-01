import { KeyboardEvent, MouseEvent } from 'react'
import { Picture } from '../types'

interface ModerationImageCardProps {
  picture: Picture
  onToggle: (fileName: string, status: 'accepted' | 'rejected') => Promise<void>
  onDelete: (fileName: string) => Promise<void>
}

export default function ModerationImageCard({ picture, onToggle, onDelete }: ModerationImageCardProps) {
  const imageLabel = `Photo ${picture.fileName}`

  const handleDelete = (event?: MouseEvent | KeyboardEvent) => {
    event?.stopPropagation()
    if (window.confirm(`Supprimer définitivement ${picture.fileName} ?`)) {
      void onDelete(picture.fileName)
    }
  }

  return (
    <div
      className={`image-container ${picture.status}`}
      data-filename={picture.fileName}
      onClick={() => void onToggle(picture.fileName, picture.status)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void onToggle(picture.fileName, picture.status)
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Basculer le statut de ${imageLabel}`}
    >
      <button
        type="button"
        className="delete-icon"
        onClick={(event) => {
          handleDelete(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleDelete(event)
          }
        }}
        aria-label={`Supprimer ${imageLabel}`}
      >
        &#10060;
      </button>
      <img
        src={`/api/admin/getthumbnail/${encodeURIComponent(picture.fileName)}`}
        alt={picture.fileName}
      />
    </div>
  )
}
