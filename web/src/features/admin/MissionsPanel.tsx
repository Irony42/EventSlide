import { useState, type FormEvent } from 'react'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { ConfirmDialog } from '../../design-system/components/ConfirmDialog'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { LoadFailure, Pending } from './components/AsyncState'
import { SelectField } from './components/SelectField'
import { useMissions } from './hooks/useEventData'
import { useCreateMission, useDeleteMission, useUpdateMission } from './hooks/useEventActions'
import styles from './MissionsPanel.module.css'
import type { MissionDto, MissionScope } from '../../lib/api/dto'

export interface MissionsPanelProps {
  readonly slug: string
}

/**
 * The host's short list of prompts (roadmap §2.1).
 *
 * Owner-only, like `ModeratorsPanel` beside it and for the same reason: `POST`, `PATCH`
 * and `DELETE` all require it, so the page mounts this for an owner rather than
 * rendering a panel whose every write comes back `403`. A moderator may *read* the list
 * — `GET` allows it — but a panel whose only affordances are refused is worse than no
 * panel, so the whole thing is the owner's.
 *
 * ## What the numbers are, and why they only ever go down as well as up
 *
 * Every count here is a query over **published** photographs rather than a stored total.
 * A host who takes a photograph down sees the count fall on the next reload, which is the
 * behaviour the whole feature rests on: a tag is a guest's claim and publishing is the
 * host's verdict.
 *
 * ## Editing exists so that a typo is not a data loss
 *
 * Deleting a mission unfiles every photograph that named it. So correcting "la première
 * dance" by deleting and re-adding would silently take four photographs out of the count
 * they were already in — which is why each row has its own edit rather than only a bin.
 */

/** The twelve in `MAX_MISSIONS_PER_EVENT`. Restated so the panel can say it. */
const MAX_MISSIONS = 12

const isScope = (value: string): value is MissionScope => value === 'guest' || value === 'event'

export function MissionsPanel({ slug }: MissionsPanelProps) {
  const t = useTranslations()
  const { data: missions, loading, error, reload } = useMissions(slug)
  const create = useCreateMission()
  const update = useUpdateMission()
  const remove = useDeleteMission()
  const toast = useToast()

  const [prompt, setPrompt] = useState('')
  const [scope, setScope] = useState<MissionScope>('guest')
  const [failure, setFailure] = useState<string | null>(null)
  /** The row being corrected, or `null` while the form is adding a new one. */
  const [editing, setEditing] = useState<MissionDto | null>(null)
  const [selected, setSelected] = useState<MissionDto | null>(null)

  const scopeOptions = [
    { value: 'guest', label: t.admin.missionScopeGuest },
    { value: 'event', label: t.admin.missionScopeEvent },
  ] as const

  const list = missions ?? []
  const full = list.length >= MAX_MISSIONS && editing === null

  const resetForm = () => {
    setPrompt('')
    setScope('guest')
    setEditing(null)
    setFailure(null)
  }

  const startEditing = (mission: MissionDto) => {
    setEditing(mission)
    setPrompt(mission.prompt)
    setScope(mission.scope)
    setFailure(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFailure(null)

    // Not trimmed here: `MissionPrompt` folds and trims on the server, and a client that
    // did it first would make the two disagree about what "empty" means.
    const input = { prompt, scope }
    const row = editing

    const done = (message: string) => {
      toast.show(message, { tone: 'success' })
      resetForm()
      reload()
    }

    if (row === null) {
      void create.run('create', slug, input).then((result) => {
        if (!result.ok) {
          setFailure(result.message)
          return
        }
        done(t.admin.missionAdded)
      })
      return
    }

    void update.run(row.id, slug, row.id, input).then((result) => {
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      done(t.admin.missionSaved)
    })
  }

  const confirmDelete = () => {
    if (selected === null) return
    void remove.run(selected.id, slug, selected.id).then((result) => {
      setSelected(null)
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      toast.show(t.admin.missionDeleted, { tone: 'success' })
      // The row being corrected may be the row just deleted.
      resetForm()
      reload()
    })
  }

  return (
    <Card as="h2" title={t.admin.missionsTitle}>
      <p className={styles['hint']}>{t.admin.missionsHint}</p>

      {loading ? <Pending label={t.app.loading} /> : null}

      {!loading && error !== null ? <LoadFailure message={error} onRetry={reload} as="h3" /> : null}

      {!loading && error === null && list.length === 0 ? (
        <EmptyState as="h3" title={t.admin.missionsEmpty} />
      ) : null}

      {!loading && error === null && list.length > 0 ? (
        <ul className={styles['list']}>
          {list.map((mission) => (
            <li key={mission.id} className={styles['row']}>
              <div className={styles['identity']}>
                <span className={styles['prompt']}>{mission.prompt}</span>
                <span className={styles['meta']}>
                  {mission.achieved
                    ? t.admin.missionAnswered(mission.publishedPhotos, mission.completedByGuests)
                    : t.admin.missionUnanswered}
                </span>
              </div>
              <Badge tone={mission.scope === 'event' ? 'accent' : 'neutral'}>
                {mission.scope === 'event' ? t.admin.missionScopeEvent : t.admin.missionScopeGuest}
              </Badge>
              <Button
                size="sm"
                aria-label={t.admin.missionEdit(mission.prompt)}
                onClick={() => startEditing(mission)}
              >
                {t.admin.missionEditShort}
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={remove.pending === mission.id}
                disabled={remove.busy}
                aria-label={t.admin.missionDelete(mission.prompt)}
                onClick={() => setSelected(mission)}
              >
                {t.admin.missionDeleteShort}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form className={styles['form']} onSubmit={submit} noValidate>
        <Field
          label={t.admin.missionPrompt}
          hint={t.admin.missionPromptHint(60)}
          {...(failure === null ? {} : { error: failure })}
        >
          {(control) => (
            <TextInput
              {...control}
              name="missionPrompt"
              autoComplete="off"
              required
              value={prompt}
              disabled={full}
              onChange={(event) => setPrompt(event.target.value)}
            />
          )}
        </Field>
        <SelectField
          label={t.admin.missionScope}
          hint={t.admin.missionScopeHint}
          value={scope}
          options={scopeOptions}
          disabled={full}
          onChange={(value) => {
            if (isScope(value)) setScope(value)
          }}
        />
        <div className={styles['actions']}>
          <Button type="submit" loading={create.busy || update.busy} disabled={full}>
            {editing === null ? t.admin.missionAdd : t.admin.missionSave}
          </Button>
          {editing === null ? null : (
            <Button variant="ghost" type="button" onClick={resetForm}>
              {t.admin.missionCancel}
            </Button>
          )}
        </div>
        {/* Said once the list is full rather than as a permanent warning: it is the
            answer to a disabled control, not a rule the host needs while there is room. */}
        {full ? <p className={styles['full']}>{t.admin.missionsFull(MAX_MISSIONS)}</p> : null}
      </form>

      <ConfirmDialog
        open={selected !== null}
        title={t.admin.missionDeleteTitle}
        description={t.admin.missionDeleteConfirm}
        confirmLabel={t.admin.missionDeleteAction}
        busy={remove.busy}
        onConfirm={confirmDelete}
        onCancel={() => setSelected(null)}
      />
    </Card>
  )
}
