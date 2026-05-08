/**
 * eventForm — composer state shape + form↔publish-shape lowering.
 *
 * Ported from mynostr's eventForm.js, slimmed for the LB write-only
 * use case: load-from-Nostr / draft-import / picked-location /
 * round-trip-export are all dropped because the LB composer is a
 * single-shot publisher, not a multi-draft tray.
 *
 * The form is a UI-friendly shape (separate startDate/startTime
 * fields, allDay flag, "tzid"). `formToPublishShape` lowers it to the
 * spec-shaped form publishCalendarEvent expects (kind 31922 vs 31923,
 * unix-second `start`, optional `start_tzid`, etc).
 */
import { KIND_DATE_EVENT, KIND_TIME_EVENT } from './eventTypes.js'

export function getUserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// Common IANA tzids hoisted to the top of the dropdown so users in
// the most common zones don't have to scroll. The user's own resolved
// tz is prepended at render time.
export const COMMON_TZIDS = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London',
  'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Athens',
  'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok',
  'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Australia/Sydney', 'UTC',
]

export function buildTzDropdownList(userTz = getUserTimezone()) {
  const out = []
  const seen = new Set()
  for (const tz of [userTz, ...COMMON_TZIDS]) {
    if (!tz || seen.has(tz)) continue
    seen.add(tz)
    out.push(tz)
  }
  return out
}

export function emptyEventForm() {
  return {
    allDay:      false,
    title:       '',
    summary:     '',
    description: '',
    startDate:   '',
    startTime:   '19:00',
    endDate:     '',
    endTime:     '21:00',
    tzid:        getUserTimezone(),
    location:    '',
    image:       '',
    hashtags:    '',
  }
}

// ── Time helpers ──────────────────────────────────────────────────────

const SECONDS_PER_DAY = 86400

// Offset, in ms, of `tz` at the given UTC instant. Positive when tz is
// ahead of UTC.
function tzOffsetMs(utcMs, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcMs)).map(p => [p.type, p.value]))
  const hour = parts.hour === '24' ? '00' : parts.hour
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hour, +parts.minute, +parts.second)
  return asUtc - utcMs
}

// "2026-04-28T19:30" (datetime-local) → unix seconds in the supplied
// IANA tz. Two-pass refines DST boundary correctness.
export function localDatetimeToUnixInTz(dtLocal, tz) {
  if (!dtLocal || !tz) return NaN
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(dtLocal)
  if (!m) return NaN
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +(m[6] || 0)
  let ms = Date.UTC(y, mo - 1, d, h, mi, s)
  ms = ms - tzOffsetMs(ms, tz)
  ms = Date.UTC(y, mo - 1, d, h, mi, s) - tzOffsetMs(ms, tz)
  return Math.floor(ms / 1000)
}

/**
 * Lower a composer form into the publish-ready shape that
 * `publishCalendarEvent` accepts. Throws on inputs that can't be
 * lowered (bad date, end-before-start, etc).
 */
export function formToPublishShape(form) {
  if (!form?.title?.trim()) throw new Error('Title is required')
  if (!form?.startDate) throw new Error('Start date is required')

  const hashtags = parseHashtags(form.hashtags)

  if (form.allDay) {
    const start = form.startDate
    const end   = form.endDate || ''
    if (end && end < start) throw new Error('End date must be on or after the start date.')
    return {
      kind: KIND_DATE_EVENT,
      title: form.title.trim(),
      summary: form.summary.trim(),
      content: form.description || '',
      start,
      end,
      image: form.image || '',
      location: form.location.trim(),
      hashtags,
    }
  }

  const tz = form.tzid || getUserTimezone()
  const startUnix = localDatetimeToUnixInTz(`${form.startDate}T${form.startTime || '00:00'}`, tz)
  if (!Number.isFinite(startUnix)) throw new Error('Could not parse the start date/time.')
  let endUnix = null
  if (form.endDate) {
    endUnix = localDatetimeToUnixInTz(`${form.endDate}T${form.endTime || form.startTime || '00:00'}`, tz)
    if (!Number.isFinite(endUnix)) throw new Error('Could not parse the end date/time.')
    if (endUnix <= startUnix) throw new Error('End must be after start.')
  }

  return {
    kind: KIND_TIME_EVENT,
    title: form.title.trim(),
    summary: form.summary.trim(),
    content: form.description || '',
    start: String(startUnix),
    end:   endUnix !== null ? String(endUnix) : '',
    startTzid: tz,
    endTzid:   tz,
    image: form.image || '',
    location: form.location.trim(),
    hashtags,
  }
}

export function parseHashtags(input) {
  const out = []
  const seen = new Set()
  for (const raw of String(input || '').split(/[\s,]+/)) {
    const t = raw.replace(/^#/, '').trim().toLowerCase()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}
