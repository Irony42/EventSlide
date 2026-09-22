import { describe, expect, it } from 'vitest'
import { MissionPrompt } from './missionPrompt'

const NEWLINE = String.fromCodePoint(0x0a)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e)

describe('MissionPrompt.create', () => {
  it('keeps what a host actually types', () => {
    const result = MissionPrompt.create('un selfie avec les mariés')

    expect(result.ok && result.value.value).toBe('un selfie avec les mariés')
  })

  it('trims surrounding whitespace', () => {
    const result = MissionPrompt.create('  la pire figure de danse  ')

    expect(result.ok && result.value.value).toBe('la pire figure de danse')
  })

  it('folds a pasted newline into one line, so a row cannot be twice the height of its neighbours', () => {
    const result = MissionPrompt.create(`un selfie${NEWLINE}avec les mariés`)

    expect(result.ok && result.value.value).toBe('un selfie avec les mariés')
  })

  it('strips a right-to-left override, which would reverse the rest of the panel', () => {
    const result = MissionPrompt.create(`${RIGHT_TO_LEFT_OVERRIDE}quelqu'un qui pleure`)

    expect(result.ok && result.value.value).toBe("quelqu'un qui pleure")
  })

  it('leaves markup alone, because React escapes it and a sanitiser here would eat "3 < 4"', () => {
    const result = MissionPrompt.create('une table de 3 < 4 personnes')

    expect(result.ok && result.value.value).toBe('une table de 3 < 4 personnes')
  })

  it('accepts a prompt of exactly the maximum length', () => {
    const result = MissionPrompt.create('x'.repeat(MissionPrompt.maxLength))

    expect(result.ok && result.value.value.length).toBe(MissionPrompt.maxLength)
  })

  it('refuses a prompt one character over the maximum length', () => {
    const result = MissionPrompt.create('x'.repeat(MissionPrompt.maxLength + 1))

    expect(!result.ok && result.error.code).toBe('mission.promptTooLong')
  })

  it('measures after stripping, so invisible padding cannot buy extra characters', () => {
    const padded = `${'x'.repeat(MissionPrompt.maxLength)}${ZERO_WIDTH_SPACE.repeat(20)}`

    const result = MissionPrompt.create(padded)

    expect(result.ok && result.value.value.length).toBe(MissionPrompt.maxLength)
  })

  it('refuses an empty prompt', () => {
    const result = MissionPrompt.create('')

    expect(!result.ok && result.error.code).toBe('mission.promptEmpty')
  })

  it('refuses a prompt that is only whitespace', () => {
    const result = MissionPrompt.create('   ')

    expect(!result.ok && result.error.code).toBe('mission.promptEmpty')
  })

  it('refuses a prompt made only of invisible padding', () => {
    const result = MissionPrompt.create(ZERO_WIDTH_SPACE.repeat(4))

    expect(!result.ok && result.error.code).toBe('mission.promptEmpty')
  })

  it('refuses a non-string, which is what a JSON body can hand the domain', () => {
    const notAString = 42 as unknown as string

    const result = MissionPrompt.create(notAString)

    expect(!result.ok && result.error.code).toBe('mission.promptInvalid')
  })
})

describe('MissionPrompt.equals', () => {
  it('compares the cleaned value, so two spellings of one prompt are one prompt', () => {
    const left = MissionPrompt.create('un  selfie')
    const right = MissionPrompt.create(' un selfie ')

    expect(left.ok && right.ok && left.value.equals(right.value)).toBe(true)
  })

  it('separates two different prompts', () => {
    const left = MissionPrompt.create('un selfie')
    const right = MissionPrompt.create('la première danse')

    expect(left.ok && right.ok && left.value.equals(right.value)).toBe(false)
  })

  it('renders as its own text', () => {
    const result = MissionPrompt.create('un selfie')

    expect(result.ok && `${result.value}`).toBe('un selfie')
  })
})
