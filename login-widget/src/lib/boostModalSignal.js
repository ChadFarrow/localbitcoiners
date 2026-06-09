/**
 * Tiny signal: "a boost modal is currently showing its own progress view".
 *
 * The BoostProgressBanner (top-of-page pulsing pill) and the in-modal
 * progress view are two surfaces for the same thing. When the modal is
 * open and showing progress it IS the primary surface, so the banner
 * should stand down — otherwise the donor sees the banner pulsing above
 * the modal, which reads as visual noise / "spasming".
 *
 * The modal sets this true while its progress view is mounted and false
 * on unmount; the banner hides itself while it's true. If the user
 * force-closes the modal mid-boost, this flips back to false and the
 * banner reappears as the fallback — exactly the handoff we want.
 */

let visible = false
const listeners = new Set()

export function setBoostModalProgressVisible(v) {
  const next = !!v
  if (next === visible) return
  visible = next
  for (const fn of listeners) {
    try { fn(visible) } catch {}
  }
}

export function isBoostModalProgressVisible() {
  return visible
}

export function onBoostModalProgressChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
