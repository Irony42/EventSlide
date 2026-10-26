import { describe, expect, it } from 'vitest'
import { JoinCode } from '../../domain/shared/joinCode'
import { SaturatedJoinCodeEventRepository } from './saturatedEventRepository'

const code = (): JoinCode => {
  const parsed = JoinCode.create('012345')
  if (!parsed.ok) throw new Error('invalid test join code')
  return parsed.value
}

describe('SaturatedJoinCodeEventRepository', () => {
  it('says every join code is taken', async () => {
    expect(await new SaturatedJoinCodeEventRepository().joinCodeTaken(code())).toBe(true)
  })

  it('counts the join codes it was asked about', async () => {
    const repository = new SaturatedJoinCodeEventRepository()

    await repository.joinCodeTaken(code())
    await repository.joinCodeTaken(code())

    expect(repository.asked).toBe(2)
  })
})
