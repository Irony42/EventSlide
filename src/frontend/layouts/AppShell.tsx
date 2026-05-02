import { PropsWithChildren } from 'react'

export default function AppShell({ children }: PropsWithChildren) {
  return <main className="page-shell">{children}</main>
}
