/**
 * Minimal Primal caching-service client — only the bits needed by the
 * meetup search modal. Singleton WebSocket, REQ/EOSE-driven query
 * dispatch, and a single helper (searchAuthors) that maps free text to
 * a ranked list of {pubkey, name, picture, followers} authors.
 *
 * Trimmed down from mynostr's lib/primal.js — full file there has
 * articles / long-reads / thread fetches we don't need on /meetups.
 */
const PRIMAL_WS_URL = 'wss://cache1.primal.net/v1'

let ws = null
let connPromise = null
let subIdCounter = 0
const subs = new Map()
const inflight = new Map()

function ensureConnected() {
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve()
  if (connPromise) return connPromise
  connPromise = new Promise((resolve, reject) => {
    const socket = new WebSocket(PRIMAL_WS_URL)
    socket.onopen = () => { ws = socket; connPromise = null; resolve() }
    socket.onerror = () => {
      connPromise = null; ws = null
      reject(new Error('Primal WebSocket failed to connect'))
    }
    socket.onclose = () => {
      ws = null; connPromise = null
      for (const [id, sub] of subs) {
        clearTimeout(sub.timer)
        sub.reject(new Error('Primal WebSocket closed unexpectedly'))
        subs.delete(id)
      }
    }
    socket.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      const [type, subId] = msg
      const sub = subs.get(subId)
      if (!sub) return
      if (type === 'EVENT') {
        sub.chunks.push(msg[2])
      } else if (type === 'EOSE') {
        clearTimeout(sub.timer)
        subs.delete(subId)
        try { ws?.send(JSON.stringify(['CLOSE', subId])) } catch {}
        sub.resolve(sub.chunks)
      }
    }
  })
  return connPromise
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return JSON.stringify(v)
  const keys = Object.keys(v).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}'
}

async function query(op, params, timeoutMs = 8000) {
  const key = `${op}:${stableStringify(params)}`
  const existing = inflight.get(key)
  if (existing) return existing
  const promise = (async () => {
    await ensureConnected()
    const subId = `lb_${++subIdCounter}_${Date.now()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        subs.delete(subId)
        reject(new Error(`Primal "${op}" timed out`))
      }, timeoutMs)
      subs.set(subId, { chunks: [], resolve, reject, timer })
      ws.send(JSON.stringify(['REQ', subId, { cache: [op, params] }]))
    })
  })()
  inflight.set(key, promise)
  promise.finally(() => inflight.delete(key))
  return promise
}

function parseProfile(ev) {
  try {
    const p = JSON.parse(ev.content)
    return { ...p, pubkey: ev.pubkey }
  } catch {
    return { pubkey: ev.pubkey }
  }
}

/**
 * Search Nostr authors by display name / username, ranked by follower
 * count. Returns up to `limit` { pubkey, name, picture, followers }.
 */
export async function searchAuthors(queryStr, limit = 8) {
  const q = String(queryStr || '').trim()
  if (!q) return []
  let searchEvents
  try {
    searchEvents = await query('user_search', { query: q, limit })
  } catch {
    return []
  }
  const pubkeys = []
  const profiles = new Map()
  for (const ev of searchEvents || []) {
    if (ev.kind === 0 && !profiles.has(ev.pubkey)) {
      profiles.set(ev.pubkey, parseProfile(ev))
      pubkeys.push(ev.pubkey)
    }
  }
  if (pubkeys.length === 0) return []

  // Follower counts (best-effort; the list still renders without them).
  const stats = new Map()
  try {
    const infos = await query('user_infos', { pubkeys }, 4000)
    for (const ev of infos || []) {
      if (ev.kind !== 10000133) continue
      try {
        const data = JSON.parse(ev.content)
        const pTag = ev.tags?.find(t => t[0] === 'p')?.[1]
        if (pTag) {
          stats.set(pTag, data)
        } else {
          for (const [pk, val] of Object.entries(data)) {
            stats.set(pk, typeof val === 'number' ? { followers_count: val } : val)
          }
        }
      } catch {}
    }
  } catch {}

  return pubkeys.map(pk => {
    const p = profiles.get(pk)
    return {
      pubkey: pk,
      name: p?.display_name || p?.name || '',
      picture: p?.picture || '',
      followers: stats.get(pk)?.followers_count ?? null,
    }
  })
}
