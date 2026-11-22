import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../../design-system/components/Button'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { useToast } from '../../../design-system/components/useToast'
import type { EventDto } from '../../../lib/api/dto'
import { canManageEvent, isMutable } from '../../../lib/eventLifecycle'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { bringIntoView } from '../bringIntoView'
import { EventQrCard } from '../components/EventQrCard'
import { useRotateJoinCode } from '../hooks/useEventActions'
import { sectionHref } from './eventSections'

/**
 * The way in for the guests: the code, the link, the QR and what is printed or sent from it
 * (surface: the host and the moderator). On the home page beside the "Maintenant" card, and on the
 * « QR code et lien » page of the menu.
 *
 * Changing the code is here and nowhere else, behind a confirmation that says what it costs: the
 * printed cards and the link already sent stop working. The toast that follows takes the host back
 * to this card, the one they print from (revue UX 30/10, HOT-2).
 */
export function EventAccessCard({
  event,
  onChanged,
}: {
  readonly event: EventDto
  readonly onChanged: (event: EventDto) => void
}) {
  const t = useTranslations()
  const toast = useToast()
  const rotate = useRotateJoinCode()
  const [rotating, setRotating] = useState(false)
  const qrHeading = useRef<HTMLHeadingElement>(null)
  const isOwner = canManageEvent(event.role)

  const confirmRotate = () => {
    void rotate.run('rotate', event.slug).then((result) => {
      setRotating(false)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      onChanged(result.value)
      toast.show(t.admin.codeRotated, {
        tone: 'success',
        action: {
          label: t.admin.codeRotatedAction,
          onAction: () => bringIntoView(qrHeading.current),
        },
      })
    })
  }

  return (
    <>
      <EventQrCard
        eventName={event.name}
        joinCode={event.joinCode}
        joinUrl={event.joinUrl}
        titleRef={qrHeading}
        // Both are for an event still in use: an archived one gets no empty row under the card.
        extraActions={
          event.status === 'archived' ? undefined : (
            <>
              <Link to={sectionHref(event.slug, 'print')}>{t.admin.printKitTitle}</Link>
              {isOwner ? (
                <Link to={sectionHref(event.slug, 'invitations')}>{t.guestInvite.host.title}</Link>
              ) : null}
              {isOwner && isMutable(event.status) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={rotate.busy}
                  onClick={() => setRotating(true)}
                  aria-haspopup="dialog"
                >
                  {t.admin.rotateJoinCode}
                </Button>
              ) : null}
            </>
          )
        }
      />
      <ConfirmDialog
        open={rotating}
        title={t.admin.rotateJoinCodeTitle}
        // Says what the change costs (the printed QR codes and the link already sent stop
        // working) and what it does not (the guests already joined).
        description={t.admin.rotateJoinCodeHint}
        confirmLabel={t.admin.rotateJoinCode}
        busy={rotate.busy}
        onConfirm={confirmRotate}
        onCancel={() => setRotating(false)}
      />
    </>
  )
}
