import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the web client's wire contract lives, for the contract tests that read it as source.
 *
 * `web/src/lib/api/dto.ts` and `client.ts` are barrels over one file per audience
 * (`dto/*.ts`, `client/*.ts`); a contract test that read only the barrel would find no
 * declaration at all and, worse, a loose one would find none and pass. `webApiFiles` therefore
 * refuses an empty directory.
 */
const API = join(process.cwd(), 'web/src/lib/api')

const filesIn = (folder: 'dto' | 'client'): readonly string[] => {
  const names = readdirSync(join(API, folder))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
  if (names.length === 0) throw new Error(`web/src/lib/api/${folder}/ holds no module to read`)
  return names.map((name) => join(API, folder, name))
}

export const webApiFiles = {
  /** Every `dto/<audience>.ts`: the interfaces and unions the wire is made of. */
  dto: (): readonly string[] => filesIn('dto'),
  /** Every `client/<audience>.ts`: the `*Api` factories and the request shapes they take. */
  client: (): readonly string[] => filesIn('client'),
}
