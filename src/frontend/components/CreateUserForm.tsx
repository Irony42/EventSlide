import { FormEvent, useState } from 'react'
import PrimaryActionButton from './PrimaryActionButton'

interface CreateUserFormProps {
  onSubmit: (username: string, password: string) => Promise<void>
}

export default function CreateUserForm({ onSubmit }: CreateUserFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    await onSubmit(username, password)
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
          required
        />
      </div>
      <PrimaryActionButton type="submit" label="Créer l'utilisateur" />
    </form>
  )
}
