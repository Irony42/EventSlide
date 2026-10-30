import { useState } from 'react'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { Notice } from '../../../design-system/components/Notice'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { EraseEverythingState } from '../hooks/useEraseEverything'
import styles from './EraseEverything.module.css'

/**
 * The guest's "delete everything I sent" (roadmap §5.2), at the foot of "Vos envois".
 *
 * A ghost button, not a primary one: it is there for the guest who looks for it, and must
 * not compete with the picker for a thumb. Pressing it opens a confirmation in plain words
 * that says what goes, that it cannot be undone, and what it cannot reach; the confirm button is
 * a different, labelled action and the dialog opens with focus on the safe choice
 * (`ConfirmDialog`). The failure sentence stays on the page after the dialog closes.
 */
export function EraseEverything({ state }: { readonly state: EraseEverythingState }) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)

  return (
    <section className={styles['root']}>
      <Button variant="ghost" size="sm" className={styles['button']} onClick={() => setOpen(true)}>
        {t.upload.eraseOpen}
      </Button>
      {state.failed ? (
        <Notice tone="warning" variant="boxed" role="alert">
          {t.upload.eraseFailed}
        </Notice>
      ) : null}
      <ConfirmDialog
        open={open && !state.done}
        title={t.upload.eraseTitle}
        description={`${t.upload.eraseBody} ${t.upload.eraseLimits}`}
        confirmLabel={t.upload.eraseConfirm}
        cancelLabel={t.upload.eraseCancel}
        busy={state.busy}
        onConfirm={() => {
          void state.erase().then(() => setOpen(false))
        }}
        onCancel={() => {
          if (!state.busy) setOpen(false)
        }}
      />
    </section>
  )
}
