import { FormEvent, useState } from 'react'
import PrimaryActionButton from './PrimaryActionButton'

interface PasswordChangeFormProps {
  onSubmit: (password: string, newPassword: string, newPassword2: string) => Promise<void>
}

export default function PasswordChangeForm({ onSubmit }: PasswordChangeFormProps) {
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await onSubmit(password, newPassword, newPassword2)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-3 text-start">
        <label htmlFor="current-password" className="form-label">
          Mot de passe courant
        </label>
        <input
          id="current-password"
          type="password"
          className="form-control"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
          required
        />
      </div>
      <div className="mb-3 text-start">
        <label htmlFor="next-password" className="form-label">
          Nouveau mot de passe
        </label>
        <input
          id="next-password"
          type="password"
          className="form-control"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          disabled={isSubmitting}
          required
        />
      </div>
      <div className="mb-4 text-start">
        <label htmlFor="next-password-confirm" className="form-label">
          Confirmer le nouveau mot de passe
        </label>
        <input
          id="next-password-confirm"
          type="password"
          className="form-control"
          value={newPassword2}
          onChange={(event) => setNewPassword2(event.target.value)}
          disabled={isSubmitting}
          required
        />
      </div>
      <PrimaryActionButton
        type="submit"
        disabled={isSubmitting}
        label={isSubmitting ? 'Mise à jour en cours...' : 'Changer de mot de passe'}
      />
    </form>
  )
}
