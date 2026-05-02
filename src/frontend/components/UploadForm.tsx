import { FormEvent, useState, useEffect } from 'react'

interface UploadFormProps {
  onUpload: (files: FileList, onProgress: (progress: number) => void) => Promise<void>
}

export default function UploadForm({ onUpload }: UploadFormProps) {
  const [files, setFiles] = useState<FileList | null>(null)
  const [previews, setPreviews] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!files) {
      setPreviews([])
      return
    }

    const objectUrls = Array.from(files).map((file) => URL.createObjectURL(file))
    setPreviews(objectUrls)

    return () => {
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [files])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!files || files.length === 0 || isSubmitting) return
    setIsSubmitting(true)
    setProgress(0)
    try {
      await onUpload(files, (p) => setProgress(p))
    } finally {
      setIsSubmitting(false)
      setProgress(0)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <label htmlFor="photos" className="form-label fw-bold">
          Prenez une photo ou choisissez des images
        </label>
        
        {/* Customized file input for mobile: capture attribute allows camera access directly */}
        <input
          type="file"
          id="photos"
          className="form-control form-control-lg"
          accept="image/*"
          multiple
          required
          disabled={isSubmitting}
          onChange={(event) => setFiles(event.target.files)}
        />
        <div className="form-text mb-3">Formats image uniquement. Vous pouvez sélectionner plusieurs fichiers.</div>

        {previews.length > 0 && (
          <div className="d-flex flex-wrap gap-2 mb-3 justify-content-center p-3 rounded-3" style={{ background: 'rgba(0,0,0,0.2)' }}>
            {previews.map((preview, index) => (
              <img
                key={index}
                src={preview}
                alt={`Preview ${index}`}
                style={{
                  width: '80px',
                  height: '80px',
                  objectFit: 'cover',
                  borderRadius: '8px',
                  border: '2px solid rgba(255,255,255,0.1)'
                }}
              />
            ))}
          </div>
        )}

      </div>
      
      {isSubmitting && progress > 0 && (
        <div className="progress mb-3" style={{ height: '20px', backgroundColor: 'rgba(255,255,255,0.1)' }}>
          <div 
            className="progress-bar progress-bar-striped progress-bar-animated bg-info" 
            role="progressbar" 
            style={{ width: `${progress}%` }} 
            aria-valuenow={progress} 
            aria-valuemin={0} 
            aria-valuemax={100}
          >
            {progress}%
          </div>
        </div>
      )}

      <button type="submit" className="btn btn-primary btn-lg w-100 fw-bold shadow-sm" disabled={isSubmitting || !files || files.length === 0}>
        {isSubmitting ? 'Envoi en cours...' : 'Envoyer les photos'}
      </button>
    </form>
  )
}
