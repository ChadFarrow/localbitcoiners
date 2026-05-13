/* Episode-page boost section.
 *
 * Fetches the show-wide boost mega-thread (same root note /boosts.html
 * uses), then filters it down to direct replies whose content carries
 * an episode marker matching this page's `data-ep-num`. Each match is
 * rendered as a card with its descendant reply tree intact (so on-topic
 * follow-up conversations stay attached to the boost that started them).
 *
 * The shared renderer lives in /assets/js/boosts-thread.js. This script
 * doesn't pass an actionsBuilder, so cards render read-only (no
 * Reply/Like/Repost/Zap bar — those still live on /boosts.html where
 * the LBLogin widget is loaded).
 */
import {
  fetchBoostThread,
  renderRepliesTree,
  renderNoteCard,
} from '/assets/js/boosts-thread.js'

(async function init() {
  const section = document.querySelector('.ep-boosts[data-ep-num]')
  if (!section) return

  const status = section.querySelector('[data-ep-boosts-status]')
  const list   = section.querySelector('[data-ep-boosts-list]')
  if (!status || !list) return

  const epNum = parseInt(section.dataset.epNum, 10)
  if (!Number.isFinite(epNum) || epNum <= 0) {
    status.textContent = ''
    section.remove()
    return
  }

  let result
  try {
    result = await fetchBoostThread()
  } catch (e) {
    console.warn('[ep-boosts] fetch failed', e)
    status.textContent = 'Couldn\'t load boosts right now — try again later.'
    return
  }

  if (result.error || !result.rootEvent) {
    status.textContent = 'Couldn\'t load boosts right now — try again later.'
    return
  }

  // Boost-bot notes carry the episode info in the 🎙️ line as
  // `Local Bitcoiners | Ep. NNN - <title>`. We match the episode number
  // word-bounded with optional leading zeros so "Ep. 11" and "Ep. 011"
  // both resolve to the same page. Anchors are the direct-reply matches
  // under the root; their full descendant tree comes along automatically
  // via renderRepliesTree.
  const epPattern = new RegExp(`\\bEp\\.?\\s*0*${epNum}\\b`, 'i')
  const directReplies = result.childrenOf.get(result.rootEvent.id) || []
  const anchors = directReplies.filter((ev) => epPattern.test(ev.content || ''))

  if (!anchors.length) {
    status.textContent = 'No boosts on this episode yet — be the first.'
    return
  }

  // Defensive sort — buildThread already orders descendants newest-first
  // but anchors come straight from the children map.
  anchors.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))

  status.remove()

  const ul = document.createElement('ul')
  ul.className = 'note-list ep-boosts-anchors'
  for (const ev of anchors) {
    const li = document.createElement('li')
    li.appendChild(renderNoteCard(ev))
    renderRepliesTree(ev.id, result.childrenOf, li)
    ul.appendChild(li)
  }
  list.appendChild(ul)
})().catch((err) => {
  console.error('[ep-boosts] init failed', err)
})
