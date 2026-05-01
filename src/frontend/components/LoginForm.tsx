import { FormEvent, useState } from 'react'
import PrimaryActionButton from './PrimaryActionButton'

interface LoginFormProps {
  onSubmit: (username: string, password: string) => Promise<void>
}

export default function LoginForm({ onSubmit }: LoginFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    await onSubmit(username, password)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3 text-start">
        <label htmlFor="username" className="form-label">
          Nom d'utilisateur
        </label>
        <input
          id="username"
          className="form-control"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
      </div>
      <div className="mb-4 text-start">
        <label htmlFor="password" className="form-label">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          className="form-control"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      <PrimaryActionButton type="submit" label="Se connecter" />
    </form>
  )
}
