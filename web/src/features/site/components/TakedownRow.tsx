import { useCallback, useId, useState, type ReactNode } from 'react'
import { useApi } from '../../../app/useApi'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { useToast } from '../../../design-system/components/useToast'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useOperatorAction } from '../hooks/useOperatorAction'
import { runTakedownOp, type TakedownOp } from '../takedownOps'
import { ReasonDialog } from './ReasonDialog'
import styles from './TakedownRow.module.css'

export interface TakedownButton {
  readonly op: TakedownOp
  readonly label: string
}

export interface TakedownRowProps {
  readonly heading: string
  /** The id the acts are sent to, in full: the operator reads exactly what it is acting on. */
  readonly id: string
  /** Facts about the target that are neither a state nor an action: where it belongs, say. */
  readonly details?: ReactNode
  readonly states: readonly {
    readonly label: string
    readonly tone: 'danger' | 'success' | 'warning'
  }[]
  readonly buttons: readonly TakedownButton[]
  /** Called once an act went through, so the card can read the new state back. */
  readonly onDone: () => void
}

/**
 * One thing the operator may act on (an event or a photograph, by id): what it is, what state it
 * is in and the acts that apply to that state, each asking for a reason in a confirmation that says
 * what it will do. **No content**: a heading made of an id, badges for the state, and buttons.
 */
export function TakedownRow({ heading, id, details, states, buttons, onDone }: TakedownRowProps) {
  const t = useTranslations()
  const api = useApi()
  const toast = useToast()
  const headingId = useId()
  const [asked, setAsked] = useState<TakedownOp | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const act = useOperatorAction(
    useCallback(
      (op: TakedownOp, target: string, reason: string) => runTakedownOp(api, op, target, reason),
      [api],
    ),
  )

  const close = () => {
    setAsked(null)
    setFailure(null)
  }

  const confirm = (reason: string) => {
    if (asked === null) return
    setFailure(null)
    void act.run(asked, asked, id, reason).then((result) => {
      if (!result.ok) {
        // `null` is a person who walked away from the step-up prompt: nothing to say.
        setFailure(result.message)
        return
      }
      close()
      toast.show(t.site.takedownDone, { tone: 'success' })
      onDone()
    })
  }

  const copy = asked === null ? null : t.site.takedownOps[asked]

  return (
    <li className={styles['row']}>
      <h3 id={headingId} className={styles['heading']}>
        {heading}
      </h3>
      <p className={styles['states']}>
        {states.map((state) => (
          <Badge key={state.label} tone={state.tone}>
            {state.label}
          </Badge>
        ))}
      </p>
      {details === undefined ? null : <p className={styles['details']}>{details}</p>}
      <div className={styles['actions']}>
        {buttons.map((button) => (
          <Button
            key={button.op}
            variant="secondary"
            disabled={act.busy}
            aria-describedby={headingId}
            onClick={() => setAsked(button.op)}
          >
            {button.label}
          </Button>
        ))}
      </div>
      <ReasonDialog
        // Remounted for each act, so a reason typed for one is never sent for another.
        key={asked ?? 'closed'}
        open={asked !== null}
        title={copy?.title ?? ''}
        description={`${heading}. ${copy?.body ?? ''}`}
        confirmLabel={copy?.confirm ?? ''}
        busy={act.busy}
        failure={failure}
        onConfirm={confirm}
        onCancel={close}
      />
    </li>
  )
}
