/**
 * CreateMeetupModal — modal wrapper around <EventComposer>.
 *
 * Opened from the meetups page's "+ Create new" entry point. Same
 * NIP-52 publisher used previously on /newevent; only the mounting
 * surface changed. The composer's optional side-effects (kind-1
 * announcement, boost-the-show) still fire through the same callbacks.
 */
import MeetupModalChrome from './MeetupModalChrome.jsx'
import EventComposer from './EventComposer.jsx'

export default function CreateMeetupModal({
  user,
  onClose,
  onRequestSignIn,
  onOpenShowBoostWithMessage,
}) {
  return (
    <MeetupModalChrome
      ariaLabel="Create a new meetup on Nostr"
      onClose={onClose}
      maxWidth="40rem"
    >
      <EventComposer
        sessionUser={user}
        onRequestSignIn={() => { onClose?.(); onRequestSignIn?.() }}
        onOpenShowBoostWithMessage={(msg) => { onClose?.(); onOpenShowBoostWithMessage?.(msg) }}
      />
    </MeetupModalChrome>
  )
}
