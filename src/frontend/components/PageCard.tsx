import { PropsWithChildren } from 'react'

interface PageCardProps extends PropsWithChildren {
  title: string
  subtitle?: string
}

export default function PageCard({ title, subtitle, children }: PageCardProps) {
  return (
    <section className="card app-card">
      <div className="card-body p-4 p-md-5">
        <h1 className="app-title h3 text-center mb-3">{title}</h1>
        {subtitle ? <p className="app-subtitle text-center mb-4">{subtitle}</p> : null}
        {children}
      </div>
    </section>
  )
}
