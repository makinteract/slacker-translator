# Slack Translator

A Slack bot that translates messages using OpenAI, with an editable preview
modal before anything gets posted.

## Features

- **`/english <text>`** and **`/korean <text>`** — translate text into a
  fixed target language.
- **`/translate <language> |> <text>`** — translate into any language you
  name.
- **"Translate" message shortcut** — right-click any message and translate
  it into English or Korean, posted as an ephemeral (only-you) reply.

For the slash commands, the bot opens a modal with the translation so you
can edit it before posting it to the channel with the `response_url`
(visible to everyone).

## Requirements

- Node.js 18+ (for built-in `fetch`)
- A Slack app with Socket Mode enabled
- An OpenAI API key

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the env template and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

   | Variable                | Description                                   |
   | ------------------------ | ---------------------------------------------- |
   | `SLACK_APP_TOKEN`        | App-level token (`xapp-...`), for Socket Mode |
   | `SLACK_BOT_TOKEN`        | Bot token (`xoxb-...`)                        |
   | `SLACK_SIGNING_SECRET`   | Signing secret from your Slack app config     |
   | `OPENAI_API_KEY`         | OpenAI API key                                |

3. In your Slack app configuration, set up:
   - Slash commands: `/english`, `/korean`, `/translate`
   - A global/message shortcut with callback ID `translate_message`
   - Socket Mode enabled, with the scopes needed for `commands`, `chat:write`,
     and opening/updating views (`views:*`)

4. Run the bot:

   ```bash
   npm start
   ```

   You should see `⚡ Slack Translator is running!` in the console.

## Project structure

- `app.js` — the entire bot: Slack command/shortcut/view handlers and the
  OpenAI translation helper.
- `.env.example` — template listing the required environment variables.

## Notes

- `.env` is git-ignored — never commit real tokens or keys.
- Slash-command translations go through an editable modal before posting;
  the message-shortcut translation is posted directly as an ephemeral
  reply and isn't editable.
