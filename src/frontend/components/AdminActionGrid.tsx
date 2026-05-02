import { Link } from 'react-router-dom'

export default function AdminActionGrid() {
  return (
    <div className="admin-grid mb-4">
      <Link to="/admin/displayer" className="btn btn-outline-light block">
        Afficher vos photos
      </Link>
      <Link to="/admin/moderation" className="btn btn-outline-light block">
        Moderer les soumissions
      </Link>
      <a href="/api/admin/downloadzip" className="btn btn-primary block">
        Telecharger toutes les photos
      </a>
    </div>
  )
}
