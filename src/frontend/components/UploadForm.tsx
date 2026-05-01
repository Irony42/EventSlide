import { FormEvent, useState } from 'react'

interface UploadFormProps {
  onUpload: (files: FileList) => Promise<void>
}

export default function UploadForm({ onUpload }: UploadFormProps) {
  const [files, setFiles] = useState<FileList | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!files || files.length === 0) return
    await onUpload(files)
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
          onChange={(event) => setFiles(event.target.files)}
        />
        <div className="form-text">Formats image uniquement. Sélection multiple autorisée.</div>
      </div>
      <button type="submit" className="btn btn-danger w-100">
        Envoyer
      </button>
    </form>
  )
}
