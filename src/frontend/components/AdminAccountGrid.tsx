import { Link } from 'react-router-dom'

export default function AdminAccountGrid() {
  return (
    <div className="admin-grid">
      <Link to="/admin/password" className="btn btn-outline-info block">
        Modifier mon mot de passe
      </Link>
      <Link to="/admin/users/new" className="btn btn-outline-info block">
        Creer un nouvel utilisateur
      </Link>
    </div>
  )
}
