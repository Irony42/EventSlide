import { useState } from 'react'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { Notice } from '../../design-system/components/Notice'
import { Async } from '../../design-system/components/Async'
import { useToast } from '../../design-system/components/useToast'
import { copyToClipboard } from '../../lib/clipboard'
import { formatDateTime } from '../../lib/format'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import type { ChannelBindingDto } from '../../lib/api/dto'
import { useChannels } from './hooks/useEventData'
import { useUnlinkChannel } from './hooks/useEventActions'
import styles from './ChannelsPanel.module.css'

export interface ChannelsPanelProps {
  readonly slug: string
  /** The event's current join code: the group sends `/soiree <code>`. */
  readonly joinCode: string
  /** Only the owner unlinks, like the endpoint: a moderator is not shown a button that would be refused. */
  readonly canUnlink: boolean
}

/**
 * The "Groupe Telegram" panel (spec 27), shown on the event page while the host's switch is on.
 *
 * It says what to do in the order the host does it (add the bot, send the command from the group) and lists the groups
 * that are connected. The bot's name is the public handle the server reads from Telegram; the command carries the
 * **current** join code, so a code the host rotated is the code shown. Nothing here identifies a group's members: the
 * title is the host's own label, the count is of media received.
 */
export function ChannelsPanel({ slug, joinCode, canUnlink }: ChannelsPanelProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const channels = useChannels(slug)
  const unlink = useUnlinkChannel()
  const toast = useToast()
  const [unlinking, setUnlinking] = useState<ChannelBindingDto | null>(null)
  const command = `/soiree ${joinCode}`

  const copy = () => {
    void copyToClipboard(command).then((copied) => {
      if (copied) toast.show(t.channels.copied, { tone: 'success' })
    })
  }

  const confirmUnlink = () => {
    if (unlinking === null) return
    void unlink.run('unlink', slug, unlinking.id).then((result) => {
      setUnlinking(null)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      toast.show(t.channels.unlinked, { tone: 'success' })
      channels.reload()
    })
  }

  return (
    <Card as="h2" title={t.channels.title} subtitle={t.channels.hint}>
      <Async state={channels} as="h3">
        {(view) =>
          !view.available || view.botUsername === null ? (
            <Notice tone="neutral" variant="boxed">
              {t.channels.noBot}
            </Notice>
          ) : (
            <div className={styles['body']}>
              <ol className={styles['steps']}>
                <li>{t.channels.step1(view.botUsername)}</li>
                <li>
                  {t.channels.step2}
                  <div className={styles['command']}>
                    <code>{command}</code>
                    <Button variant="secondary" onClick={copy}>
                      {t.channels.copyCommand}
                    </Button>
                  </div>
                </li>
              </ol>
              <p className={styles['reminder']}>{t.channels.visibility}</p>

              <h3 className={styles['listTitle']}>{t.channels.listTitle}</h3>
              {view.bindings.length === 0 ? (
                <p className={styles['none']}>{t.channels.none}</p>
              ) : (
                <ul className={styles['list']}>
                  {view.bindings.map((binding) => (
                    <li key={binding.id} className={styles['row']}>
                      <div>
                        <strong>{binding.title}</strong>
                        <p className={styles['meta']}>
                          {t.channels.boundOn(
                            formatDateTime(binding.boundAt, locale) ?? binding.boundAt,
                          )}
                          {' · '}
                          {t.channels.photos(binding.photoCount)}
                        </p>
                      </div>
                      {canUnlink ? (
                        <Button variant="secondary" onClick={() => setUnlinking(binding)}>
                          {t.channels.unlink}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        }
      </Async>

      <ConfirmDialog
        open={unlinking !== null}
        title={t.channels.unlinkConfirmTitle}
        description={unlinking === null ? '' : t.channels.unlinkConfirmBody(unlinking.title)}
        confirmLabel={t.channels.unlink}
        busy={unlink.busy}
        onConfirm={confirmUnlink}
        onCancel={() => setUnlinking(null)}
      />
    </Card>
  )
}
