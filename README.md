# Slack Translator

A Slack bot that translates messages using OpenAI, with an editable preview
modal before anything gets posted.

## Features

- **`/english <text>`** and **`/korean <text>`** — translate text into a
  fixed target language.
- **`/translate <language> |> <text>`** — translate into any language you
  name.
- **`/setkey`** — save your own OpenAI API key, used for your translations
  instead of the shared bot key.
- **`/removekey`** — delete your saved API key.

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
   | `OPENAI_API_KEY`         | Shared/fallback OpenAI API key, used when a user hasn't set their own      |
   | `KEY_STORE_SECRET`       | Passphrase used to encrypt personal API keys at rest (required for `/setkey`) |

3. In your Slack app configuration, set up:
   - Slash commands: `/english`, `/korean`, `/translate`, `/setkey`, `/removekey`
   - Socket Mode enabled, with the scopes needed for `commands`, `chat:write`,
     `im:write`, and opening/updating views (`views:*`)

4. Run the bot:

   ```bash
   npm start
   ```

   You should see `⚡ Slack Translator is running!` in the console.

## Project structure

- `app.js` — the entire bot: Slack command/view handlers and the OpenAI
  translation helper.
- `keyStore.js` — encrypted storage for personal OpenAI API keys
  (`data/user-keys.json`, gitignored), keyed by Slack user ID.
- `.env.example` — template listing the required environment variables.

## Notes

- `.env` is git-ignored — never commit real tokens or keys.
- Slash-command translations go through an editable modal before posting.
- Personal API keys saved via `/setkey` are encrypted at rest with
  `KEY_STORE_SECRET` and never shown back in Slack; `/removekey` deletes a
  saved key. If a user hasn't set one, translations fall back to the
  shared `OPENAI_API_KEY`.
