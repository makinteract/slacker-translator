# Slack Translator

A Slack bot that translates messages using OpenAI, with an editable preview
modal before anything gets posted.

## Features

- **`/english <text>`** and **`/korean <text>`** — translate text into a
  fixed target language.
- **`/translate <language> |> <text>`** — translate into any language you
  name.
- **`/setkey`** — (admins/owners only) save an OpenAI API key for this
  workspace, used for every translation in the space instead of the shared
  bot key.
- **`/removekey`** — (admins/owners only) delete the workspace's saved API
  key.
- **"Translate to Korean" / "Translate to English"** — message shortcuts
  (available from a message's `•••` menu). Translates that message and
  replies with an ephemeral message visible only to the person who ran the
  shortcut — nothing is posted for anyone else to see.

For the slash commands, the bot opens a modal with the translation so you
can edit it before posting it to the channel with the `response_url`
(visible to everyone).

## Requirements

- Node.js 18+ (for built-in `fetch`)
- A Slack app with Socket Mode enabled
- An OpenAI API key (shared bot key, personal user keys, or both)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the env template and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

   | Variable                | Description                                                                 |
   | ------------------------ | ---------------------------------------------------------------------------- |
   | `SLACK_APP_TOKEN`        | App-level token (`xapp-...`), for Socket Mode                              |
   | `SLACK_BOT_TOKEN`        | Bot token (`xoxb-...`)                                                      |
   | `SLACK_SIGNING_SECRET`   | Signing secret from your Slack app config                                  |
   | `OPENAI_API_KEY`         | Shared/fallback OpenAI API key, used when a workspace hasn't set its own   |
   | `KEY_STORE_SECRET`       | Passphrase used to encrypt per-workspace API keys at rest (required for `/setkey`) |

3. In your Slack app configuration, set up:
   - Slash commands: `/english`, `/korean`, `/translate`, `/setkey`, `/removekey`
   - Interactivity & Shortcuts → Shortcuts → create two **On messages**
     shortcuts:
     - "Translate to Korean" with callback ID `translate_to_korean`
     - "Translate to English" with callback ID `translate_to_english`
   - Socket Mode enabled, with the scopes needed for `commands`, `chat:write`,
     `im:write`, opening/updating views (`views:*`), and `users:read` (used to
     check whether the caller of `/setkey`/`/removekey` is a workspace
     admin/owner). `chat:write` also covers posting the ephemeral
     translations from the message shortcuts.

4. Run the bot:

   ```bash
   npm start
   ```

   You should see `⚡ Slack Translator is running!` in the console.

## Project structure

- `app.js` — the entire bot: Slack command/view handlers and the OpenAI
  translation helper.
- `keyStore.js` — encrypted storage for per-workspace OpenAI API keys
  (`data/space-keys.json`, gitignored), keyed by Slack team/workspace ID.
- `.env.example` — template listing the required environment variables.

## Notes

- `.env` is git-ignored — never commit real tokens or keys.
- Slash-command translations go through an editable modal before posting.
- The workspace API key is shared by everyone in the space — only Slack
  admins/owners can run `/setkey` or `/removekey`; other members get an
  ephemeral "admins only" message.
- Keys saved via `/setkey` are encrypted at rest with `KEY_STORE_SECRET`
  and never shown back in Slack; `/removekey` deletes the saved key. If a
  workspace hasn't set one, translations fall back to the shared
  `OPENAI_API_KEY`.
