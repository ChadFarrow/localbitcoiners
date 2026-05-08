/**
 * Blossom upload — NIP-94 / BUD-02 image upload to blossom.primal.net.
 *
 * Ported verbatim from mynostr/src/lib/blossom.js. Same server, same
 * auth shape (kind 24242 with sha256 hash + 5-min expiration).
 */
import { getNDK, signWithTimeout } from './ndk.js'
import { NDKEvent } from '@nostr-dev-kit/ndk'

const BLOSSOM_SERVER = 'https://blossom.primal.net'

async function sha256Hex(buffer) {
  if (!crypto?.subtle) {
    throw new Error('Image upload requires HTTPS or localhost. LAN access over HTTP is not supported.')
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function buildAuthEvent(fileHash) {
  const ndk = getNDK()
  const expiration = Math.floor(Date.now() / 1000) + 60 * 5

  const event = new NDKEvent(ndk)
  event.kind = 24242
  event.content = 'Upload image'
  event.tags = [
    ['t', 'upload'],
    ['x', fileHash],
    ['expiration', String(expiration)],
  ]
  await signWithTimeout(event)
  return JSON.stringify(await event.toNostrEvent())
}

export async function uploadToBlossom(file) {
  const buffer = await file.arrayBuffer()
  const hash = await sha256Hex(buffer)
  const authEventJson = await buildAuthEvent(hash)
  const authHeader = 'Nostr ' + btoa(authEventJson)

  const res = await fetch(`${BLOSSOM_SERVER}/upload`, {
    method: 'PUT',
    headers: {
      'Authorization': authHeader,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: buffer,
  })

  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`Blossom upload failed (${res.status})${msg ? ': ' + msg : ''}`)
  }

  const data = await res.json()
  const url = data.url || data.nip94_event?.tags?.find(t => t[0] === 'url')?.[1]
  if (!url) throw new Error('Blossom response missing URL')
  return url
}
