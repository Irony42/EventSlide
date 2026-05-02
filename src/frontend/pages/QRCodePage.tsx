import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { useSession } from '../hooks/useSession'
import BackToAdminLink from '../components/BackToAdminLink'

export default function QRCodePage() {
  const { session } = useSession()
  const [uploadUrl, setUploadUrl] = useState('')

  useEffect(() => {
    if (session?.user?.partyId) {
      const baseUrl = window.location.origin
      setUploadUrl(`${baseUrl}/upload?partyname=${session.user.partyId}`)
    }
  }, [session])

  return (
    <div className="container py-5 text-center d-flex flex-column align-items-center justify-content-center min-vh-100">
      <div className="mb-4">
        <BackToAdminLink />
      </div>
      <div className="app-card p-5 rounded-4 d-flex flex-column align-items-center">
        <h1 className="h2 mb-4">Rejoindre la galerie</h1>
        <p className="text-muted mb-5">Scannez ce QR Code pour envoyer vos photos !</p>
        
        <div className="bg-white p-4 rounded-4 mb-4" style={{ display: 'inline-block' }}>
          {uploadUrl ? (
            <QRCodeSVG value={uploadUrl} size={300} level="H" includeMargin={true} />
          ) : (
            <div style={{ width: 300, height: 300 }} className="d-flex align-items-center justify-content-center">
              Chargement...
            </div>
          )}
        </div>
        
        {uploadUrl && (
          <a href={uploadUrl} target="_blank" rel="noreferrer" className="text-decoration-none">
            {uploadUrl}
          </a>
        )}
      </div>
    </div>
  )
}
