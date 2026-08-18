import { App } from '@slack/bolt';
import OpenAI from 'openai';
import dotenv from 'dotenv';

import { deleteSpaceApiKey, getSpaceApiKey, setSpaceApiKey } from './keyStore.js';

dotenv.config();

// --------------------------------------------------
// OPENAI
// --------------------------------------------------

// Shared fallback client, used when a space has not set its own key.
const sharedOpenAI = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Cache of per-space OpenAI clients, keyed by Slack team/workspace ID.
const spaceOpenAIClients = new Map();

function getOpenAIClient(teamId) {
  const spaceApiKey = getSpaceApiKey(teamId);

  if (!spaceApiKey) {
    return sharedOpenAI;
  }

  if (!spaceOpenAIClients.has(teamId)) {
    spaceOpenAIClients.set(teamId, new OpenAI({ apiKey: spaceApiKey }));
  }

  return spaceOpenAIClients.get(teamId);
}

function forgetOpenAIClient(teamId) {
  spaceOpenAIClients.delete(teamId);
}

// --------------------------------------------------
// HELPER: CHECK WORKSPACE ADMIN
// --------------------------------------------------

async function isWorkspaceAdmin(client, userId) {
  try {
    const { user } = await client.users.info({ user: userId });
    return Boolean(user?.is_admin || user?.is_owner || user?.is_primary_owner);
  } catch (error) {
    console.error('users.info failed while checking admin status:', error);
    return false;
  }
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

async function translateText(text, language, teamId) {
  const client = getOpenAIClient(teamId);

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
    const translation = await translateText(text, language, command.team_id);

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
        ? 'No OpenAI API key is configured for this workspace. Ask a workspace admin to run `/setkey`.'
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
// HELPER: REGISTER A MESSAGE SHORTCUT
// (translate a message in place, reply privately to the requester)
// --------------------------------------------------

function registerTranslateShortcut(callbackId, language) {
  app.shortcut(callbackId, async ({ shortcut, ack, respond }) => {
    await ack();

    const teamId = shortcut.team?.id;
    const text = shortcut.message?.text?.trim();

    if (!text) {
      await respond({
        response_type: 'ephemeral',
        text: 'That message has no text to translate.',
      });

      return;
    }

    try {
      const translation = await translateText(text, language, teamId);

      await respond({
        response_type: 'ephemeral',
        text: `*${language} translation (only visible to you):*\n${translation}`,
      });
    } catch (error) {
      console.error(`${callbackId} error:`, error);

      const failureText =
        error.message === 'NO_API_KEY'
          ? 'No OpenAI API key is configured for this workspace. Ask a workspace admin to run `/setkey`.'
          : `Translation failed: ${error.message}`;

      await respond({
        response_type: 'ephemeral',
        text: failureText,
      });
    }
  });
}

registerTranslateShortcut('translate_to_korean', 'Korean');
registerTranslateShortcut('translate_to_english', 'English');

// --------------------------------------------------
// WORKSPACE OPENAI API KEY
// (admin/owner only — the key applies to the whole space)
// --------------------------------------------------

app.command('/setkey', async ({ command, ack, client, respond }) => {
  await ack();

  const admin = await isWorkspaceAdmin(client, command.user_id);

  if (!admin) {
    await respond({
      response_type: 'ephemeral',
      text: 'Only workspace admins or owners can set the shared OpenAI API key.',
    });

    return;
  }

  try {
    await client.views.open({
      trigger_id: command.trigger_id,

      view: {
        type: 'modal',
        callback_id: 'setkey_submit',

        private_metadata: JSON.stringify({
          team: command.team_id,
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
              text: 'Paste an OpenAI API key for this workspace. It will be used instead of the shared bot key for every translation in this space. Run `/removekey` to delete it later.',
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
    setSpaceApiKey(metadata.team, apiKey);
    forgetOpenAIClient(metadata.team);

    await client.chat.postMessage({
      channel: metadata.user,
      text: 'The workspace OpenAI API key has been saved. It will be used for every translation in this space from now on.',
    });
  } catch (error) {
    console.error('/setkey save error:', error);

    try {
      await client.chat.postMessage({
        channel: metadata.user,
        text: `Something went wrong saving the workspace API key: ${error.message}`,
      });
    } catch (slackError) {
      console.error('Slack error message failed:', slackError);
    }
  }
});

app.command('/removekey', async ({ command, ack, client, respond }) => {
  await ack();

  const admin = await isWorkspaceAdmin(client, command.user_id);

  if (!admin) {
    await respond({
      response_type: 'ephemeral',
      text: 'Only workspace admins or owners can remove the shared OpenAI API key.',
    });

    return;
  }

  try {
    const removed = deleteSpaceApiKey(command.team_id);
    forgetOpenAIClient(command.team_id);

    await respond({
      response_type: 'ephemeral',
      text: removed
        ? 'The workspace OpenAI API key has been removed. Translations will use the shared bot key, if configured.'
        : 'This workspace doesn\'t have its own OpenAI API key set.',
    });
  } catch (error) {
    console.error('/removekey error:', error);

    await respond({
      response_type: 'ephemeral',
      text: `Something went wrong removing the workspace API key: ${error.message}`,
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
