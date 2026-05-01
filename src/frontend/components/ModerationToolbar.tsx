import BackToAdminLink from './BackToAdminLink'

export default function ModerationToolbar() {
  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-4">
        <h1 className="h3 mb-0 app-title">Moderation des photos</h1>
        <BackToAdminLink />
      </div>
      <p className="app-subtitle mb-4">
        Cliquez une image pour alterner accepte/refuse. Cliquez sur la croix pour supprimer.
      </p>
    </>
  )
}
