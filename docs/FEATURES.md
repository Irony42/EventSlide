# What EventSlide does, in full

The long version of the [README](../README.md#what-it-does): every feature, by who it is for.

- **Guests join by scanning.** A QR code, a six-character code, a first name if they
  feel like it. No account, no download, no email.
- **Nothing reaches the screen without you.** Every photo waits in a moderation queue
  until you approve it. Two hundred people are watching that screen; that is not a
  setting to leave to chance.
- **The wall is meant to be looked at.** One photo at a time, whole and with a slow
  zoom, or one of six other layouts; captions and the sender's name, a join code in the
  corner for whoever arrives late.
- **It survives the venue.** Uploads retry, the wall keeps playing when the network
  drops, and it runs unattended for an eight-hour evening — true for a box running on
  site; a wall served by the hosted instance still depends on the venue's own internet
  connection.
- **Privacy is handled, not mentioned.** Location data and device identifiers are
  stripped from every photo on arrival — a guest's camera records the coordinates of
  wherever they are standing, and that is often somebody's home.
- **Guests are told what happens to their photos, before the first one.**
  Who sees it, whether you check it before the screen, how long it is kept and how to
  have it removed — written from your event's own settings, in the guest's language, so
  it cannot say something your configuration does not do. Read once per phone, and shown
  again if you change one of those settings mid-evening.
- **Your favourites, in one ZIP.** Star the best photos in the moderation console (or pre-select the
  most liked), then download just those from the event page.
- **The album is yours afterwards.** One ZIP, full resolution, and an automatic purge
  when you choose one.
- **And your guests', with one link.** The morning after, make a shared gallery link on
  the event page and send it to everybody: the photographs that were on the wall, in full
  resolution and without their location data, to download one by one or as a ZIP. It
  expires when you say (a month unless you choose otherwise), it can ask for a password,
  and you can switch it off at any moment — from then on it opens nothing.

And the parts that only show up on the night:

- **Photo missions give guests something to do.** You write a short list of prompts — "a
  selfie with the couple", "the worst dance move", "someone crying" — and guests see them
  as a checklist. It changes the question in their head from "should I bother uploading
  this" to "which one is left".
- **Short video clips too**, not only photographs. Fifteen seconds, transcoded on the
  box, played on the wall without sound — because a room already has music.
- **Moderate from your phone.** One photograph at a time, swipe right to publish, left
  to refuse. The person deciding is usually standing up with a drink, not sitting at a
  laptop.
- **The upload survives the venue Wi-Fi.** A photo picked with no signal is queued on
  the phone and sent when there is some, even if the guest has closed the page —
  EventSlide installs as an app if they let it, and keeps working when the network does
  not.
- **It speaks everybody's language, not only the guest's.** French, English, Spanish,
  German and Italian, across the whole interface: the guest's phone, the moderation
  console, the admin pages and the projected wall. International weddings are the normal
  case, and so is a moderator who is not the person who installed the box.

  A guest and a host each pick their own from a control in the header, and it is
  remembered. The wall is the exception and it is the interesting one: there is nobody in
  front of a projector to ask, so its language is a setting on the **event**, chosen by
  whoever created it and defaulted to the language they were reading at the time.

  What is never translated is what people write. An event's name, a caption, a guest's
  display name and a mission prompt are shown exactly as typed — so a German wall over a
  French wedding prints German labels above French prompts, which is the right way round.
  A native reader has not yet gone over the German, Spanish and Italian copy on the host
  and wall surfaces; the French is hand-written and is the source the rest is translated
  from.

- **It looks like the evening it is running.** Each event wears an ambiance: the
  product's own violet by default, or one of six designed worlds — Guinguette, Riviera,
  Golden fields, Bivouac, Cabaret and Wedding, in red and white — each with its own
  surfaces, inks, display face and background photograph. A venue photograph of your own
  can replace that background. On top of the ambiance the host picks an accent colour, a
  font pairing and a frame style; the wall takes all three (the frame in the layouts that
  draw one), and the guests' phones the colour. The colour is checked against the
  accessibility contract server-side — the text on it must read at ten metres, and in a
  designed ambiance it must not pass for the colours that mean success, warning or error
  — and one that fails is refused rather than rendered.
- **Or one you make yourself.** The Custom ambiance lets the host choose a light or dark
  ground, its tint, the accent and the faces, on a simulation page that shows the
  guest's phone and the wall live before anything is saved. Every combination it offers
  is proven legible in advance, so there is no way to make a wall nobody can read.
- **The wall looks after its own projector.** If the machine driving it cannot hold its
  frame rate, it gives up the slow zoom before the crossfade, rather than stuttering
  through an eight-hour evening.
