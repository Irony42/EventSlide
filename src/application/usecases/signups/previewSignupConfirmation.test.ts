import { describe, expect, it } from 'vitest'
import { aForm, buildSignupScene } from '../../testing/signupScene'

describe('previewSignupConfirmation', () => {
  it('shows a usable link with the masked address, and spends nothing', async () => {
    const scene = buildSignupScene()
    await scene.submit()
    const token = scene.lastToken()

    const first = await scene.preview({ token })
    const second = await scene.preview({ token })

    expect(first).toEqual({
      ok: true,
      value: { state: 'usable', maskedEmail: 'l•••@example.test' },
    })
    expect(second).toEqual(first)
    expect(scene.signups.all[0]?.status).toBe('unconfirmed')
  })

  it('says spent once the link was used', async () => {
    const scene = buildSignupScene({ mode: 'review' })
    await scene.submit()
    const token = scene.lastToken()
    await scene.confirm({ token })

    expect(await scene.preview({ token })).toMatchObject({ ok: true, value: { state: 'spent' } })
  })

  it('says expired after 24 hours', async () => {
    const scene = buildSignupScene()
    await scene.submit()
    const token = scene.lastToken()
    scene.clock.advance(24 * 60 * 60 * 1000)

    expect(await scene.preview({ token })).toMatchObject({ ok: true, value: { state: 'expired' } })
  })

  it('answers 404 for a token no confirmation ever had', async () => {
    const scene = buildSignupScene()
    expect(await scene.preview({ token: 'nothing' })).toMatchObject({
      ok: false,
      error: { code: 'signup.confirmationNotFound' },
    })
  })

  it('answers 404 feature.unavailable while SIGNUP is off', async () => {
    const scene = buildSignupScene({ mode: 'off' })
    expect(await scene.preview({ token: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'feature.unavailable' },
    })
  })

  it('does not depend on the form: any request that mailed a link can be previewed', async () => {
    const scene = buildSignupScene()
    await scene.submit(aForm({ email: 'zed@example.test' }))
    expect(await scene.preview({ token: scene.lastToken() })).toMatchObject({
      value: { maskedEmail: 'z•••@example.test' },
    })
  })
})
