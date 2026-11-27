import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parseLocale } from '../../../../lib/i18n/locale'
import { useLocale } from '../../../../lib/i18n/useTranslations'

/**
 * `?lang=fr|en|de|es|it` preselects the language of a signup page (spec 31): the marketing site
 * links to `/signup?lang=de`, and the mail's link carries the language the request was made in.
 *
 * Applied once per value, so a visitor who then picks another language in the header is not
 * taken back; an unknown value is ignored.
 */
export const useLangParam = (): void => {
  const { setLocale } = useLocale()
  const [params] = useSearchParams()
  const asked = parseLocale(params.get('lang'))

  useEffect(() => {
    if (asked !== null) setLocale(asked)
    // `setLocale` must not re-apply the address's language over the picker's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked])
}
