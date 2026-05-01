import { Picture } from '../types'

interface ModerationImageCardProps {
  picture: Picture
  onToggle: (fileName: string, status: 'accepted' | 'rejected') => Promise<void>
  onDelete: (fileName: string) => Promise<void>
}

export default function ModerationImageCard({ picture, onToggle, onDelete }: ModerationImageCardProps) {
  return (
    <div
      className={`image-container ${picture.status}`}
      data-filename={picture.fileName}
      onClick={() => onToggle(picture.fileName, picture.status)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onToggle(picture.fileName, picture.status)
      }}
      role="button"
      tabIndex={0}
    >
      <span
        className="delete-icon"
        onClick={(event) => {
          event.stopPropagation()
          onDelete(picture.fileName)
        }}
      >
        &#10060;
      </span>
      <img
        src={`/api/admin/getthumbnail/${encodeURIComponent(picture.fileName)}`}
        alt={picture.fileName}
      />
    </div>
  )
}
