import { useCallback, useId, useState, type FormEvent } from 'react'
import { useApi } from '../../../app/useApi'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { Field } from '../../../design-system/components/Field'
import { Progress } from '../../../design-system/components/Progress'
import { TextInput } from '../../../design-system/components/TextInput'
import { useToast } from '../../../design-system/components/useToast'
import type { SiteClientDto } from '../../../lib/api/dto'
import { formatBytes, formatDateTime } from '../../../lib/format'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { useOperatorAction } from '../hooks/useOperatorAction'
import { standingLabel, standingOf, standingTone } from '../siteLabels'
import styles from './ClientSummary.module.css'

export interface ClientSummaryProps {
  readonly client: SiteClientDto
  /** Something changed on the server: read the client again. */
  readonly onChanged: () => void
}

/**
 * Who the client is and what it is using, with the three acts on the client itself: rename it,
 * freeze it, lift the freeze.
 *
 * Surface: the operator's laptop. The two meters are the numbers the upload paths enforce
 * (`usedBytes` is the figure a guest is refused against), drawn against the ceiling when there is
 * one. **A suspension is one confirmation and one step-up**, because it takes a client's walls and
 * galleries off the public the moment it lands; the dialog says exactly what it does and what it
 * does not (nothing deleted, no account switched off). A client that is being wound down (the
 * server set a purge date) offers neither, and that is the console's decision and not a rule it is
 * told: ending an engagement is its own act (offboarding, G2-14 part 3), a suspension that came
 * with it is part of it, and a button that lifts the freeze of a client whose albums are about to be
 * purged would offer to undo half of something the operator chose to do whole.
 */
export function ClientSummary({ client, onChanged }: ClientSummaryProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const api = useApi()
  const toast = useToast()
  const standing = standingOf(client)
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const suspend = useOperatorAction(useCallback((id: string) => api.siteSuspendClient(id), [api]))
  const resume = useOperatorAction(useCallback((id: string) => api.siteResumeClient(id), [api]))
  const freezing = standing === 'active'
  const act = freezing ? suspend : resume

  const confirm = () => {
    void act.run('standing', client.id).then((result) => {
      setConfirming(false)
      if (!result.ok) {
        if (result.message !== null) toast.show(result.message, { tone: 'danger' })
        return
      }
      toast.show(freezing ? t.site.suspended : t.site.resumed, { tone: 'success' })
      onChanged()
    })
  }

  const { maxEvents, maxTotalBytes } = client.ceilings
  const used = formatBytes(client.usage.usedBytes, locale)
  const date = (iso: string): string => formatDateTime(iso, locale) ?? iso

  return (
    <Card
      as="h1"
      title={client.name}
      subtitle={t.site.memberCount(client.usage.memberCount)}
      footer={
        <div className={styles['actions']}>
          <Button variant="secondary" size="sm" onClick={() => setRenaming((now) => !now)}>
            {t.site.rename}
          </Button>
          {standing === 'offboarding' ? null : (
            <Button
              variant={freezing ? 'danger' : 'primary'}
              size="sm"
              disabled={act.busy}
              onClick={() => setConfirming(true)}
            >
              {freezing ? t.site.suspend : t.site.resume}
            </Button>
          )}
        </div>
      }
    >
      <p className={styles['standing']}>
        <Badge tone={standingTone(standing)}>{standingLabel(standing, t)}</Badge>
        {client.suspendedAt === null ? null : (
          <span>{t.site.suspendedSince(date(client.suspendedAt))}</span>
        )}
        {client.purgeAfter === null ? null : <span>{t.site.purgeOn(date(client.purgeAfter))}</span>}
      </p>

      <ul className={styles['meters']}>
        <li>
          <span>{t.site.eventsCell(client.usage.eventCount, client.usage.liveEventCount)}</span>
          {maxEvents === null ? null : (
            <Progress value={client.usage.eventCount} max={maxEvents} label={t.site.eventsColumn} />
          )}
        </li>
        <li>
          <span>
            {maxTotalBytes === null
              ? `${used} · ${t.site.noCeiling}`
              : t.site.storageOf(used, formatBytes(maxTotalBytes, locale))}
          </span>
          {maxTotalBytes === null ? null : (
            <Progress
              value={client.usage.usedBytes}
              max={maxTotalBytes}
              label={t.site.storageColumn}
            />
          )}
        </li>
        {client.ceilings.maxEventsPerPeriod === null ? null : (
          <li>{t.site.periodEvents(client.eventsCreatedInPeriod)}</li>
        )}
      </ul>

      {renaming ? (
        <RenameForm
          client={client}
          onDone={() => {
            setRenaming(false)
            onChanged()
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={freezing ? t.site.suspendTitle : t.site.resumeTitle}
        description={freezing ? t.site.suspendBody : t.site.resumeBody}
        confirmLabel={freezing ? t.site.suspend : t.site.resume}
        busy={act.busy}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  )
}

function RenameForm({
  client,
  onDone,
}: {
  readonly client: SiteClientDto
  readonly onDone: () => void
}) {
  const t = useTranslations()
  const api = useApi()
  const toast = useToast()
  const formId = useId()
  const [name, setName] = useState(client.name)
  const [failure, setFailure] = useState<string | null>(null)
  const rename = useOperatorAction(
    useCallback((id: string, next: string) => api.siteRenameClient(id, next), [api]),
  )

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    void rename.run('rename', client.id, name.trim()).then((result) => {
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      toast.show(t.site.renamed, { tone: 'success' })
      onDone()
    })
  }

  return (
    <form id={formId} className={styles['rename']} onSubmit={submit}>
      <Field label={t.site.renameTitle}>
        {(control) => (
          <TextInput
            {...control}
            name="name"
            autoComplete="off"
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      {failure === null ? null : <p role="alert">{failure}</p>}
      <div>
        <Button type="submit" variant="primary" size="sm" loading={rename.busy}>
          {t.site.rename}
        </Button>
      </div>
    </form>
  )
}
