import { App } from '@slack/bolt';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// --------------------------------------------------
// OPENAI
// --------------------------------------------------

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

async function translateText(text, language) {
  const response = await openai.responses.create({
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
    const translation = await translateText(text, language);

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
              text: 'Translation failed. Please try again.',
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
// /ENGLISH
// --------------------------------------------------

app.command('/english', async ({ command, ack, client, respond }) => {
  await ack();

  const text = command.text.trim();

  if (!text) {
    await respond({
      response_type: 'ephemeral',
      text: 'Please enter some text after /english.',
    });

    return;
  }

  try {
    await openTranslationModal({
      command,
      client,
      language: 'English',
      callbackId: 'english_submit',
    });
  } catch (error) {
    console.error('/english error:', error);
  }
});

// --------------------------------------------------
// /KOREAN
// --------------------------------------------------

app.command('/korean', async ({ command, ack, client, respond }) => {
  await ack();

  const text = command.text.trim();

  if (!text) {
    await respond({
      response_type: 'ephemeral',
      text: 'Please enter some text after /korean.',
    });

    return;
  }

  try {
    await openTranslationModal({
      command,
      client,
      language: 'Korean',
      callbackId: 'korean_submit',
    });
  } catch (error) {
    console.error('/korean error:', error);
  }
});

// --------------------------------------------------
// ENGLISH MODAL SUBMIT
// --------------------------------------------------

app.view('english_submit', async ({ ack, view }) => {
  await ack();

  try {
    await postTranslation(view, 'English');
  } catch (error) {
    console.error('English post error:', error);
  }
});

// --------------------------------------------------
// KOREAN MODAL SUBMIT
// --------------------------------------------------

app.view('korean_submit', async ({ ack, view }) => {
  await ack();

  try {
    await postTranslation(view, 'Korean');
  } catch (error) {
    console.error('Korean post error:', error);
  }
});

// --------------------------------------------------
// MESSAGE SHORTCUT
// --------------------------------------------------

app.shortcut('translate_message', async ({ shortcut, ack, client }) => {
  await ack();

  await client.views.open({
    trigger_id: shortcut.trigger_id,

    view: {
      type: 'modal',
      callback_id: 'translate_submit',

      private_metadata: JSON.stringify({
        text: shortcut.message.text,
        channel: shortcut.channel.id,
      }),

      title: {
        type: 'plain_text',
        text: 'Translate',
      },

      submit: {
        type: 'plain_text',
        text: 'Translate',
      },

      close: {
        type: 'plain_text',
        text: 'Cancel',
      },

      blocks: [
        {
          type: 'input',
          block_id: 'language',

          label: {
            type: 'plain_text',
            text: 'Translate to',
          },

          element: {
            type: 'static_select',
            action_id: 'target_language',

            placeholder: {
              type: 'plain_text',
              text: 'Choose a language',
            },

            options: [
              {
                text: {
                  type: 'plain_text',
                  text: 'English',
                },
                value: 'English',
              },

              {
                text: {
                  type: 'plain_text',
                  text: 'Korean',
                },
                value: 'Korean',
              },
            ],
          },
        },
      ],
    },
  });
});

// --------------------------------------------------
// MESSAGE SHORTCUT TRANSLATION
// --------------------------------------------------

app.view('translate_submit', async ({ ack, view, body, client }) => {
  await ack();

  const metadata = JSON.parse(view.private_metadata);

  const language =
    view.state.values.language.target_language.selected_option.value;

  try {
    const translation = await translateText(metadata.text, language);

    await client.chat.postEphemeral({
      channel: metadata.channel,
      user: body.user.id,

      text: `*${language} translation:*\n\n${translation}`,
    });
  } catch (error) {
    console.error('Message translation error:', error);

    try {
      await client.chat.postEphemeral({
        channel: metadata.channel,
        user: body.user.id,
        text: 'Translation failed. Please try again.',
      });
    } catch (slackError) {
      console.error('Slack error message failed:', slackError);
    }
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
