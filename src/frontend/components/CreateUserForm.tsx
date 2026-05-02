import { FormEvent, useState } from 'react'
import PrimaryActionButton from './PrimaryActionButton'

interface CreateUserFormProps {
  onSubmit: (username: string, password: string) => Promise<void>
}

export default function CreateUserForm({ onSubmit }: CreateUserFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await onSubmit(username, password)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3 text-start">
        <label htmlFor="new-username" className="form-label">
          Nom d'utilisateur
        </label>
        <input
          id="new-username"
          className="form-control"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={isSubmitting}
          required
        />
      </div>
      <div className="mb-4 text-start">
        <label htmlFor="new-password" className="form-label">
          Mot de passe
        </label>
        <input
          id="new-password"
          type="password"
          className="form-control"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
          required
        />
      </div>
      <PrimaryActionButton
        type="submit"
        disabled={isSubmitting}
        label={isSubmitting ? 'Création en cours...' : "Créer l'utilisateur"}
      />
    </form>
  )
}
