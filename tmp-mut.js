const fs = require('fs')
const { execSync } = require('child_process')

const M = [
  ['rank: removed guest stays', 'src/domain/stats/contributorRanking.ts', '!entry.revoked && entry.photos > 0', 'entry.photos > 0', 'src/domain/stats'],
  ['rank: zero-send guest stays', 'src/domain/stats/contributorRanking.ts', '!entry.revoked && entry.photos > 0', '!entry.revoked', 'src/domain/stats'],
  ['rank: anonymous listed one by one', 'src/domain/stats/contributorRanking.ts', "entry.displayName === null ? [] : [{ ...entry, displayName: entry.displayName }]", "[{ ...entry, displayName: entry.displayName ?? 'anon' }]", 'src/domain/stats'],
  ['rank: cap of ten dropped', 'src/domain/stats/contributorRanking.ts', '.slice(0, Math.min(limit, TOP_CONTRIBUTORS_LIMIT))', '.slice(0, limit)', 'src/domain/stats'],
  ['sql: byStatus keeps taken-down', 'src/infrastructure/db/sqliteEventStatsRepository.ts', "WHERE event_id = ? AND taken_down_at IS NULL GROUP BY status", "WHERE event_id = ? GROUP BY status", 'src/infrastructure/db/sqliteEventStatsRepository.test.ts'],
  ['sql: reactions on taken-down photos leak', 'src/infrastructure/db/sqliteEventStatsRepository.ts', "WHERE r.event_id = ? AND p.event_id = ? AND p.taken_down_at IS NULL\n               GROUP BY r.kind", "WHERE r.event_id = ? AND p.event_id = ?\n               GROUP BY r.kind", 'src/infrastructure/db/sqliteEventStatsRepository.test.ts'],
  ['sql: byQuarter by hour', 'src/infrastructure/db/sqliteEventStatsRepository.ts', "CAST(substr(created_at, 15, 2) AS INTEGER) / 15) * 15", "CAST(substr(created_at, 15, 2) AS INTEGER) / 60) * 60", 'src/infrastructure/db/sqliteEventStatsRepository.test.ts'],
  ['sql: byQuarter ignores event', 'src/infrastructure/db/sqliteEventStatsRepository.ts', "               WHERE event_id = ? AND taken_down_at IS NULL\n               GROUP BY start", "               WHERE ? IS NOT NULL AND taken_down_at IS NULL\n               GROUP BY start", 'src/infrastructure/db/sqliteEventStatsRepository.test.ts'],
  ['sql: guests ignores event', 'src/infrastructure/db/sqliteEventStatsRepository.ts', "COUNT(revoked_at) AS revoked FROM guests WHERE event_id = ?", "COUNT(revoked_at) AS revoked FROM guests WHERE ? IS NOT NULL", 'src/infrastructure/db/sqliteEventStatsRepository.test.ts'],
  ['usecase: no readable check', 'src/application/usecases/stats/getEventStats.ts', 'if (!readable.ok) return readable', '', 'src/application/usecases/stats'],
  ['usecase: no role check', 'src/application/usecases/stats/getEventStats.ts', 'if (!allowed.ok) return allowed', '', 'src/application/usecases/stats'],
  ['hook: reactions trigger a read', 'web/src/features/admin/hooks/useEventStats.ts', "'guest.erased',\n])", "'guest.erased',\n  'reaction.added',\n])", 'web/src/features/admin/EventStatsPage.test.tsx'],
  ['hook: keeps reading after 403', 'web/src/features/admin/hooks/useEventStats.ts', 'if (!refused.current) reload()', 'reload()', 'web/src/features/admin/EventStatsPage.test.tsx'],
  ['hook: no debounce', 'web/src/features/admin/hooks/useEventStats.ts', 'if (!SIGNALS.has(signal.type) || pending.current !== null) return', 'if (!SIGNALS.has(signal.type)) return', 'web/src/features/admin/EventStatsPage.test.tsx'],
  ['web: bars on UTC hours', 'web/src/features/admin/lib/uploadsByHour.ts', 'offsetAt: OffsetAt = browserOffset', 'offsetAt: OffsetAt = () => 0', 'web/src/features/admin/lib'],
  ['route: no-store dropped', 'src/interface/http/routes/eventRoutes.ts', "        response.setHeader('Cache-Control', 'no-store')\n        sendJson<EventStatsResponseDto>", "        sendJson<EventStatsResponseDto>", 'src/interface/http/routes/eventRoutes.test.ts'],
]

for (const [name, file, from, to, target] of M) {
  const original = fs.readFileSync(file, 'utf8')
  if (!original.includes(from)) {
    console.log(`SKIP (pattern missing) ${name}`)
    continue
  }
  fs.writeFileSync(file, original.replace(from, to))
  let out = ''
  try {
    out = execSync(`npx vitest run ${target} --maxWorkers=2 2>&1`, { encoding: 'utf8', timeout: 280000 })
  } catch (e) {
    out = String(e.stdout || '')
  } finally {
    fs.writeFileSync(file, original)
  }
  const failed = (out.match(/Tests\s+(\d+) failed/) || [])[1]
  const names = [...out.matchAll(/ FAIL .*? > (.*)/g)].slice(0, 2).map((m) => m[1].slice(0, 90))
  console.log(`${failed ? 'RED ' + failed : 'SURVIVED'}  ${name}  ${names.join(' | ')}`)
}
