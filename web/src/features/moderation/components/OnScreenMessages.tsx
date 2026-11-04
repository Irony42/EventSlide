import { useState } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Dialog } from '../../../design-system/components/Dialog'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './OnScreenMessages.module.css'
import type { GuestbookQueueItemDto } from '../../../lib/api/dto'

/**
 * "Derniers messages à l'écran" (spec 15): the phone's way to take a published message off
 * the wall, as the photo strip is for photos. Without it a message published in automatic
 * moderation could not be removed from the phone, which has no filter and no swipe for it.
 *
 * Each message is folded on two lines with a real "Lire" button that opens the whole text and
 * the one action, "Retirer". Nothing here takes a message down on the first touch.
 */
export interface OnScreenMessagesProps {
  readonly messages: readonly GuestbookQueueItemDto[]
  readonly busy: boolean
  readonly onRemove: (entryId: string) => void
}

export function OnScreenMessages({ messages, busy, onRemove }: OnScreenMessagesProps) {
  const t = useTranslations()
  const [openId, setOpenId] = useState<string | null>(null)
  const open = messages.find((message) => message.id === openId) ?? null
  const authorOf = (message: GuestbookQueueItemDto) =>
    message.authorName ?? t.guestbookHost.anonymous

  return (
    <section className={styles['strip']} aria-labelledby="on-screen-messages-title">
      <h2 id="on-screen-messages-title" className={styles['title']}>
        {t.moderation.onScreenMessagesTitle}
      </h2>
      {messages.length === 0 ? (
        <p className={styles['hint']}>{t.moderation.onScreenMessagesEmpty}</p>
      ) : (
        <ul className={styles['list']}>
          {messages.map((message) => (
            <li key={message.id} className={styles['item']}>
              <p className={styles['folded']} translate="no">
                {message.text}
              </p>
              <Button
                variant="secondary"
                size="md"
                aria-label={t.moderation.readMessageOf(authorOf(message))}
                onClick={() => setOpenId(message.id)}
              >
                {t.moderation.readMessage}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={open !== null}
        title={open === null ? '' : t.moderation.messageOf(authorOf(open))}
        onClose={() => setOpenId(null)}
        footer={
          open === null ? null : (
            <Button
              variant="danger"
              size="lg"
              block
              loading={busy}
              aria-label={t.moderation.hidePhoto(authorOf(open))}
              onClick={() => {
                onRemove(open.id)
                setOpenId(null)
              }}
            >
              {t.moderation.hide}
            </Button>
          )
        }
      >
        {open === null ? null : (
          <p className={styles['full']} translate="no">
            {open.text}
          </p>
        )}
      </Dialog>
    </section>
  )
}
