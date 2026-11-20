# Telegram: photographs from a group

A host can connect a Telegram group to an event. What the members post there (photographs, short videos, pictures sent as
files) becomes photographs and clips of the event, through the same pipelines, moderation and quotas as a phone. This page is
for the operator who installs the bot and the host who uses it. The design is in
[ADR 0015](adr/0015-messaging-channels.md), the security argument in [SECURITY.md](SECURITY.md) §28.

## For the operator: one bot, one token

The box **calls** Telegram (one long poll); Telegram never calls the box. There is no webhook and no new public route, so
nothing about your reverse proxy changes. With no token set the box opens no outbound connection for this, and the host's
panel says there is no bot.

1. In Telegram, talk to **@BotFather** and send `/newbot`. Pick a name and a username ending in `bot`. BotFather gives you a
   token that looks like `123456789:AA...`.
2. **Let the bot see the photographs of a group.** Either send `/setprivacy` to BotFather, choose your bot and pick
   **Disable**, or make the bot an administrator of each group. Without one of the two, Telegram only gives a bot the
   commands, never the photographs.
3. Optional: `/setjoingroups` to **Enable** (or Disable, if only you should be able to add it to groups).
4. Put the token in `.env` (**it is a credential**; never in `compose.yaml`, never in a log; the box never logs it):

   ```
   TELEGRAM_BOT_TOKEN=123456789:AA...
   ```

   and restart. The log says `telegram channel ready` with the bot's name. A token Telegram refuses turns the function off
   with a warning and the rest of the server starts; fix the token and restart.

5. On a hosted box with plans, turn **channels** on for the client in the operator console (or set
   `NEW_CLIENT_CHANNELS_ALLOWED=true` for new clients). A self-hosted box with no client needs nothing more.

**One token is one instance.** Two boxes polling with the same token fight over the updates (Telegram answers 409); the second
one says so in its log. Use one bot per box. Optional settings: `TELEGRAM_API_BASE_URL` (a local Bot API server lifts the
20 MB file limit of the public one), `TELEGRAM_MAX_FILE_BYTES`, `MAX_QUEUED_CHANNEL_MEDIA_PER_EVENT`
(see [.env.example](../.env.example)).

If the box is down, Telegram keeps the updates for 24 hours and the box resumes where it stopped.

## For the host

1. **Settings, "Messageries"**: switch on "Recevoir les photos d'un groupe Telegram". The switch is absent when the box has
   no bot, and greyed ("Non inclus dans votre offre") when your plan does not include it.
2. The event page now shows a **"Groupe Telegram"** panel: add the bot to your group, then send the command it shows
   (`/soiree` and the current join code) from the group. The bot answers once, in the language of the evening, and tells
   the group whether photos go through you first.
3. Every photograph or video posted in the group is taken (a thumbs up appears on the message) and follows the event's
   moderation mode. In the console, a badge "via Telegram" tells where it came from.
4. **Délier** in the panel (owner only) stops the group; the bot says so in the group and stays in it.

In the group: `/oublier` erases everything the sender posted for this event; `/confidentialite` sends the notice's address.
Text, stickers, polls and other bots are ignored and never stored. A group already linked to another event that is still
live is refused; the host of that event unlinks it first.

## What is kept

A fingerprint of the Telegram account (different at every event, and not reversible without the box's secret), the guest's
first name and the initial of the last name (`Léa M.`), the group's title, and a counter of media received. No number, no
`@handle`, no message text. See [SECURITY.md](SECURITY.md) §28.
