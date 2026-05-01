import { FormEvent, useState } from 'react'

interface UploadFormProps {
  onUpload: (files: FileList) => Promise<void>
}

export default function UploadForm({ onUpload }: UploadFormProps) {
  const [files, setFiles] = useState<FileList | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!files || files.length === 0 || isSubmitting) return
    setIsSubmitting(true)
    try {
      await onUpload(files)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <label htmlFor="photos" className="form-label">
          Photos
        </label>
        <input
          type="file"
          id="photos"
          className="form-control"
          accept="image/*"
          multiple
          required
          disabled={isSubmitting}
          onChange={(event) => setFiles(event.target.files)}
        />
        <div className="form-text">Formats image uniquement. Sélection multiple autorisée.</div>
      </div>
      <button type="submit" className="btn btn-danger w-100" disabled={isSubmitting}>
        {isSubmitting ? 'Envoi en cours...' : 'Envoyer'}
      </button>
    </form>
  )
}
