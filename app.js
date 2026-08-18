import { App } from '@slack/bolt';
import OpenAI from 'openai';
import dotenv from 'dotenv';

import { deleteUserApiKey, getUserApiKey, setUserApiKey } from './keyStore.js';

dotenv.config();

// --------------------------------------------------
// OPENAI
// --------------------------------------------------

// Shared fallback client, used when a user has not set a personal key.
const sharedOpenAI = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Cache of per-user OpenAI clients, keyed by Slack user ID.
const userOpenAIClients = new Map();

function getOpenAIClient(userId) {
  const userApiKey = getUserApiKey(userId);

  if (!userApiKey) {
    return sharedOpenAI;
  }

  if (!userOpenAIClients.has(userId)) {
    userOpenAIClients.set(userId, new OpenAI({ apiKey: userApiKey }));
  }

  return userOpenAIClients.get(userId);
}

function forgetOpenAIClient(userId) {
  userOpenAIClients.delete(userId);
}

// --------------------------------------------------
// SLACK
// --------------------------------------------------

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// --------------------------------------------------
// HELPER: TRANSLATE TEXT
// --------------------------------------------------

async function translateText(text, language, userId) {
  const client = getOpenAIClient(userId);

  if (!client) {
    throw new Error('NO_API_KEY');
  }

  const response = await client.responses.create({
    model: 'gpt-5.6',

    input: `Translate the following text into natural ${language}.

Preserve:
- meaning
- tone
- names
- URLs
- Slack mentions
- formatting

Do not add explanations.
Return only the translated text.

Text:
${text}`,
  });

  return response.output_text.trim();
}

// --------------------------------------------------
// HELPER: OPEN TRANSLATION MODAL
// --------------------------------------------------

async function openTranslationModal({ command, client, language, callbackId }) {
  const text = command.text.trim();

  // Open immediately so Slack's trigger_id does not expire
  const modal = await client.views.open({
    trigger_id: command.trigger_id,

    view: {
      type: 'modal',
      callback_id: callbackId,

      private_metadata: JSON.stringify({
        response_url: command.response_url,
        user: command.user_id,
        language,
      }),

      title: {
        type: 'plain_text',
        text: `${language} Translation`,
      },

      close: {
        type: 'plain_text',
        text: 'Cancel',
      },

      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Translating...',
          },
        },
      ],
    },
  });

  try {
    const translation = await translateText(text, language, command.user_id);

    // Replace "Translating..." with an editable input
    await client.views.update({
      view_id: modal.view.id,

      view: {
        type: 'modal',
        callback_id: callbackId,

        private_metadata: JSON.stringify({
          response_url: command.response_url,
          user: command.user_id,
          language,
        }),

        title: {
          type: 'plain_text',
          text: `${language} Translation`,
        },

        submit: {
          type: 'plain_text',
          text: 'Post',
        },

        close: {
          type: 'plain_text',
          text: 'Cancel',
        },

        blocks: [
          {
            type: 'input',
            block_id: 'translation',

            label: {
              type: 'plain_text',
              text: 'Edit translation',
            },

            element: {
              type: 'plain_text_input',
              action_id: 'text',
              multiline: true,
              initial_value: translation,
            },
          },
        ],
      },
    });
  } catch (error) {
    console.error(`${language} translation error:`, error);

    const failureText =
      error.message === 'NO_API_KEY'
        ? 'No OpenAI API key is configured. Run `/setkey` to add your own, or ask an admin to set one up.'
        : `Translation failed: ${error.message}`;

    await client.views.update({
      view_id: modal.view.id,

      view: {
        type: 'modal',

        title: {
          type: 'plain_text',
          text: `${language} Translation`,
        },

        close: {
          type: 'plain_text',
          text: 'Close',
        },

        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: failureText,
            },
          },
        ],
      },
    });
  }
}

// --------------------------------------------------
// HELPER: POST EDITED TRANSLATION
// --------------------------------------------------

async function postTranslation(view, language) {
  const metadata = JSON.parse(view.private_metadata);

  const editedTranslation = view.state.values.translation.text.value.trim();

  if (!editedTranslation) {
    return;
  }

  const response = await fetch(metadata.response_url, {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
    },

    body: JSON.stringify({
      response_type: 'in_channel',
      text: `From <@${metadata.user}>:\n${editedTranslation}`,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    console.error(`${language} Slack post failed:`, response.status, errorText);
  }
}

// --------------------------------------------------
// HELPER: REGISTER A FIXED-LANGUAGE SLASH COMMAND
// (e.g. /english, /korean)
// --------------------------------------------------

function registerLanguageCommand(commandName, language, callbackId) {
  app.command(commandName, async ({ command, ack, client, respond }) => {
    await ack();

    const text = command.text.trim();

    if (!text) {
      await respond({
        response_type: 'ephemeral',
        text: `Please enter some text after ${commandName}.`,
      });

      return;
    }

    try {
      await openTranslationModal({ command, client, language, callbackId });
    } catch (error) {
      console.error(`${commandName} error:`, error);
    }
  });
}

registerLanguageCommand('/english', 'English', 'english_submit');
registerLanguageCommand('/korean', 'Korean', 'korean_submit');

// --------------------------------------------------
// HELPER: REGISTER A FIXED-LANGUAGE MODAL SUBMIT
// --------------------------------------------------

function registerLanguageSubmit(callbackId, language) {
  app.view(callbackId, async ({ ack, view }) => {
    await ack();

    try {
      await postTranslation(view, language);
    } catch (error) {
      console.error(`${language} post error:`, error);
    }
  });
}

registerLanguageSubmit('english_submit', 'English');
registerLanguageSubmit('korean_submit', 'Korean');

// --------------------------------------------------
// PERSONAL OPENAI API KEY
// --------------------------------------------------

app.command('/setkey', async ({ command, ack, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: command.trigger_id,

      view: {
        type: 'modal',
        callback_id: 'setkey_submit',

        private_metadata: JSON.stringify({
          user: command.user_id,
        }),

        title: {
          type: 'plain_text',
          text: 'OpenAI API Key',
        },

        submit: {
          type: 'plain_text',
          text: 'Save',
        },

        close: {
          type: 'plain_text',
          text: 'Cancel',
        },

        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Paste your personal OpenAI API key. It will be used instead of the shared bot key for your translations. Run `/removekey` to delete it later.',
            },
          },
          {
            type: 'input',
            block_id: 'api_key',

            label: {
              type: 'plain_text',
              text: 'API key',
            },

            element: {
              type: 'plain_text_input',
              action_id: 'value',

              placeholder: {
                type: 'plain_text',
                text: 'sk-...',
              },
            },
          },
        ],
      },
    });
  } catch (error) {
    console.error('/setkey error:', error);
  }
});

app.view('setkey_submit', async ({ ack, view, client }) => {
  const metadata = JSON.parse(view.private_metadata);
  const apiKey = view.state.values.api_key.value.value.trim();

  if (!apiKey.startsWith('sk-')) {
    await ack({
      response_action: 'errors',
      errors: {
        api_key: 'That doesn\'t look like a valid OpenAI API key (it should start with "sk-").',
      },
    });

    return;
  }

  await ack();

  try {
    setUserApiKey(metadata.user, apiKey);
    forgetOpenAIClient(metadata.user);

    await client.chat.postMessage({
      channel: metadata.user,
      text: 'Your personal OpenAI API key has been saved. It will be used for your translations from now on.',
    });
  } catch (error) {
    console.error('/setkey save error:', error);

    try {
      await client.chat.postMessage({
        channel: metadata.user,
        text: `Something went wrong saving your API key: ${error.message}`,
      });
    } catch (slackError) {
      console.error('Slack error message failed:', slackError);
    }
  }
});

app.command('/removekey', async ({ command, ack, respond }) => {
  await ack();

  try {
    const removed = deleteUserApiKey(command.user_id);
    forgetOpenAIClient(command.user_id);

    await respond({
      response_type: 'ephemeral',
      text: removed
        ? 'Your personal OpenAI API key has been removed. Translations will use the shared bot key, if configured.'
        : 'You don\'t have a personal OpenAI API key set.',
    });
  } catch (error) {
    console.error('/removekey error:', error);

    await respond({
      response_type: 'ephemeral',
      text: `Something went wrong removing your API key: ${error.message}`,
    });
  }
});

app.command('/translate', async ({ command, ack, client, respond }) => {
  await ack();

  const raw = command.text.trim();

  if (!raw) {
    await respond({
      response_type: 'ephemeral',
      text: 'Usage: /translate language |> message',
    });
    return;
  }

  const separator = '|>';
  const separatorIndex = raw.indexOf(separator);

  if (separatorIndex === -1) {
    await respond({
      response_type: 'ephemeral',
      text: 'Please use: /translate language |> message',
    });
    return;
  }

  const language = raw.slice(0, separatorIndex).trim();

  const text = raw.slice(separatorIndex + separator.length).trim();

  if (!language || !text) {
    await respond({
      response_type: 'ephemeral',
      text: 'Please use: /translate language |> message',
    });
    return;
  }

  try {
    await openTranslationModal({
      command: {
        ...command,
        text,
      },
      client,
      language,
      callbackId: 'generic_translate_submit',
    });
  } catch (error) {
    console.error('/translate error:', error);
  }
});

app.view('generic_translate_submit', async ({ ack, view }) => {
  await ack();

  try {
    const metadata = JSON.parse(view.private_metadata);

    await postTranslation(view, metadata.language);
  } catch (error) {
    console.error('Generic translation post error:', error);
  }
});

// --------------------------------------------------
// START APP
// --------------------------------------------------

(async () => {
  await app.start();

  console.log('⚡ Slack Translator is running!');
})();
