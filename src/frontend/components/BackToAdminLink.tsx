import { Link } from 'react-router-dom'

export default function BackToAdminLink() {
  return (
    <Link to="/admin" className="btn btn-outline-light">
      Retour administration
    </Link>
  )
}
