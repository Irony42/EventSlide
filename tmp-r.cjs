const fs=require('fs')
const edit=(p,pairs)=>{let s=fs.readFileSync(p,'utf8');for(const [a,b] of pairs){if(!s.includes(a))throw new Error(p+' missing '+a.slice(0,60));s=s.replace(a,()=>b)}fs.writeFileSync(p,s)}
// 1 venue hold
for (const f of ['removeVenuePhoto','setVenuePhoto']) edit(`src/application/usecases/venue/${f}.ts`,[[
`    const writable = requireWritable(event)
    if (!writable.ok) return writable
`,`    const writable = requireWritable(event)
    if (!writable.ok) return writable

    // A held event keeps every file it has, the venue photograph's included (launch review S5).
    if (event.isPurgeHeld()) return err(DomainError.conflict('event.purgeUnavailable'))
`]])
// 2 neutral signals
edit('src/application/usecases/site/setPhotoTakedown.ts',[[
`    bus.publish({
      type: down ? 'photo.takenDown' : 'photo.restored',
      eventId: located.eventId,
      photoId,
    })`,`    // A neutral signal that already means "read again": the stream forwards a signal's type to the
    // host and to every guest, and none of them is told that the operator acted (runbook csam.md).
    bus.publish({
      type: down ? 'photo.deleted' : 'photo.uploaded',
      eventId: located.eventId,
      photoId,
    })`],["(\`photo.takenDown\`, a signal with ids and nothing else)","(a neutral \`photo.deleted\` or \`photo.uploaded\` signal, which never says why)"]])
edit('src/application/usecases/site/setEventTakedown.ts',[[
`    bus.publish({ type: down ? 'event.takenDown' : 'event.restored', eventId: event.id })`,
`    // Neutral, like the photograph's: the stream forwards the type to everyone who listens.
    bus.publish({ type: 'event.settingsChanged', eventId: event.id })`],["after hearing `event.takenDown`","after hearing `event.settingsChanged`"]])
let p='src/application/ports/eventBus.ts';let s=fs.readFileSync(p,'utf8')
s=s.replace(/  \/\*\*\n   \* The operator took a photograph down[\s\S]*?photo\.restored[^\n]*\n/,'')
s=s.replace(/  \/\*\* The operator took the whole event down[^\n]*\n  \| \{ readonly type: 'event\.takenDown'[^\n]*\n  \| \{ readonly type: 'event\.restored'[^\n]*\n/,'')
fs.writeFileSync(p,s)
// 3 counts
edit('src/infrastructure/db/sqliteEventRepository.ts',[[
"const COUNT_COLUMNS = `(SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id) AS photo_count,\n              (SELECT COUNT(*) FROM photos p\n                WHERE p.event_id = e.id AND p.status = 'pending')      AS pending_count,",
"const COUNT_COLUMNS = `(SELECT COUNT(*) FROM photos p\n                WHERE p.event_id = e.id AND p.taken_down_at IS NULL) AS photo_count,\n              (SELECT COUNT(*) FROM photos p\n                WHERE p.event_id = e.id AND p.status = 'pending'\n                  AND p.taken_down_at IS NULL)                         AS pending_count,"]])
edit('src/infrastructure/db/sqliteGuestRepository.ts',[["             AND p.author_guest_id = g.id) AS photo_count","             AND p.author_guest_id = g.id\n             AND p.taken_down_at IS NULL) AS photo_count"]])
edit('src/infrastructure/db/sqliteMissionRepository.ts',[
["          WHERE event_id = ?\n            AND mission_id IS NOT NULL\n            AND status = 'published'\n          GROUP BY","          WHERE event_id = ?\n            AND mission_id IS NOT NULL\n            AND status = 'published'\n            AND taken_down_at IS NULL\n          GROUP BY"],
["            AND mission_id IS NOT NULL\n            AND status = 'published'`","            AND mission_id IS NOT NULL\n            AND status = 'published'\n            AND taken_down_at IS NULL`"]])
edit('src/application/testing/fakePhotoRepository.ts',[
["  ofEvent(eventId: EventId): readonly Photo[] {\n    return this.forEvent(eventId)","  ofEvent(eventId: EventId): readonly Photo[] {\n    return this.visibleOf(eventId)"],
["    return this.authoredBy(eventId, guestId)\n","    // The author's cap counts every row, taken-down ones included, as the adapter's does.\n    return this.forEvent(eventId).filter((photo) => this.matchesAuthor(photo, guestId)).length\n"],
["    return this.forEvent(eventId).filter((photo) => this.matchesAuthor(photo, guestId)).length\n  }\n\n  deleteAuthoredBy","    return this.visibleOf(eventId).filter((photo) => this.matchesAuthor(photo, guestId)).length\n  }\n\n  deleteAuthoredBy"]])
