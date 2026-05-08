/**
 * eventTypes — NIP-52 calendar-event helpers (parse-side).
 *
 * Two addressable Nostr kinds are used by the composer:
 *
 *   31922 — date-based event (full-day, no timezone)
 *   31923 — time-based event (Unix-second precision, IANA tzid)
 *
 * The composer only writes — there's no feed/discover/RSVP UI on the
 * Local Bitcoiners site — but we still keep the parse helpers around
 * because (a) the success panel decodes the published event's naddr
 * to derive a coordinate for the kind-1 announcement and (b) any
 * future read-side feature can lean on the same shape.
 *
 * Ported from mynostr's eventTypes.js. The full module there also
 * handles RSVP (kind 31925) parsing and dedup; that's intentionally
 * not ported because LB doesn't display events.
 */
import { nip19 } from 'nostr-tools'

export const KIND_DATE_EVENT = 31922
export const KIND_TIME_EVENT = 31923

export function isCalendarEventKind(k) {
  return k === KIND_DATE_EVENT || k === KIND_TIME_EVENT
}

function tagValue(ev, name) {
  return ev?.tags?.find(t => t[0] === name)?.[1] || ''
}
function tagValues(ev, name) {
  if (!ev?.tags) return []
  return ev.tags.filter(t => t[0] === name && typeof t[1] === 'string').map(t => t[1])
}

/**
 * Parse a raw NDKEvent (or {kind, pubkey, tags, content, created_at, id})
 * into a normalized shape. Returns null if the event isn't a valid
 * 31922/31923 — callers can skip rather than render garbage.
 */
export function parseCalendarEvent(ev) {
  if (!ev || !isCalendarEventKind(ev.kind)) return null
  const dTag = tagValue(ev, 'd')
  if (!dTag) return null
  const title = tagValue(ev, 'title')
  if (!title) return null
  const startRaw = tagValue(ev, 'start')
  if (!startRaw) return null

  const isDateBased = ev.kind === KIND_DATE_EVENT
  const endRaw = tagValue(ev, 'end')

  let startUnix, endUnix = null, startTzid = '', endTzid = ''
  if (isDateBased) {
    startUnix = ymdToUnixUtc(startRaw)
    endUnix   = endRaw ? ymdToUnixUtc(endRaw) + 86400 - 1 : null
  } else {
    startUnix = parseUnixSeconds(startRaw)
    endUnix   = endRaw ? parseUnixSeconds(endRaw) : null
    // Sanitize tzids at parse time — events in the wild carry junk like
    // "Munich, DE" or "EST" instead of IANA ids. Intl.DateTimeFormat
    // throws RangeError on invalid zones.
    startTzid = sanitizeTzid(tagValue(ev, 'start_tzid'))
    endTzid   = sanitizeTzid(tagValue(ev, 'end_tzid')) || startTzid
  }
  if (!Number.isFinite(startUnix)) return null

  let naddr = ''
  try {
    naddr = nip19.naddrEncode({ kind: ev.kind, pubkey: ev.pubkey, identifier: dTag })
  } catch {}

  return {
    id: ev.id || '',
    pubkey: ev.pubkey || '',
    kind: ev.kind,
    dTag,
    naddr,
    title,
    summary: tagValue(ev, 'summary'),
    content: ev.content || '',
    image: tagValue(ev, 'image'),
    location: tagValue(ev, 'location'),
    geohash: tagValue(ev, 'g'),
    hashtags: tagValues(ev, 't'),
    isDateBased,
    start: startRaw,
    end: endRaw,
    startTzid,
    endTzid,
    startUnix,
    endUnix,
    createdAt: ev.created_at || 0,
  }
}

/**
 * "<kind>:<authorpk>:<dtag>" — used as the `a` tag value when a kind 1
 * announcement quotes the published event.
 */
export function coordOf(parsed) {
  if (!parsed) return ''
  return `${parsed.kind}:${parsed.pubkey}:${parsed.dTag}`
}

// ── Internal helpers ──────────────────────────────────────────────────

function parseUnixSeconds(s) {
  const n = parseInt(String(s).trim(), 10)
  return Number.isFinite(n) ? n : NaN
}

function sanitizeTzid(raw) {
  const tz = String(raw || '').trim()
  if (!tz) return ''
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return ''
  }
}

function ymdToUnixUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim())
  if (!m) return NaN
  const y = +m[1], mo = +m[2], d = +m[3]
  const t = Date.UTC(y, mo - 1, d, 0, 0, 0)
  return Math.floor(t / 1000)
}
