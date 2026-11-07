import { describe, expect, it } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import { photoLabels } from './photoLabels'

describe('photoLabels', () => {
  it('names the author in the three places for a photo with a caption', () => {
    expect(photoLabels({ authorName: 'Léa', caption: 'Les confettis' }, false, fr)).toEqual({
      authorInName: 'Léa',
      authorLine: fr.moderation.by('Léa'),
      alt: fr.moderation.photoAltWithCaption('Les confettis', 'Léa'),
    })
  })

  it('describes a photo with no caption by its author alone', () => {
    expect(photoLabels({ authorName: 'Léa', caption: null }, false, fr).alt).toBe(
      fr.moderation.photoAlt('Léa'),
    )
  })

  it('says video for a clip, with and without a caption', () => {
    expect(photoLabels({ authorName: 'Léa', caption: null }, true, fr).alt).toBe(
      fr.moderation.videoAlt('Léa'),
    )
    expect(photoLabels({ authorName: 'Léa', caption: 'Le toast' }, true, fr).alt).toBe(
      fr.moderation.videoAltWithCaption('Le toast', 'Léa'),
    )
  })

  it('reads an anonymous guest in the sentence and on the caption line differently', () => {
    const labels = photoLabels({ authorName: null, caption: null }, false, fr)
    expect(labels.authorInName).toBe(fr.moderation.anonymousInName)
    expect(labels.authorLine).toBe(fr.moderation.byAnonymous)
    expect(labels.alt).toBe(fr.moderation.photoAlt(fr.moderation.anonymousInName))
  })
})
