import { App } from '@slack/bolt';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Slack
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// --------------------------------------------------
// TRANSLATE MESSAGE SHORTCUT
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
// HANDLE TRANSLATION
// --------------------------------------------------

app.view('translate_submit', async ({ ack, view, body, client }) => {
  await ack();

  const metadata = JSON.parse(view.private_metadata);

  const language =
    view.state.values.language.target_language.selected_option.value;

  try {
    const response = await openai.responses.create({
      model: 'gpt-5.6',

      input: `Translate the following Slack message into ${language}.

Preserve:
- meaning
- tone
- names
- URLs
- Slack mentions
- formatting

Return only the translated text.

Message:
${metadata.text}`,
    });

    const translation = response.output_text;

    await client.chat.postEphemeral({
      channel: metadata.channel,
      user: body.user.id,
      text: `*${language} translation:*\n\n${translation}`,
    });
  } catch (error) {
    console.error('Translation error:', error);

    await client.chat.postEphemeral({
      channel: metadata.channel,
      user: body.user.id,
      text: 'Translation failed. Please try again.',
    });
  }
});

app.command('/english', async ({ command, ack, respond }) => {
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
    const response = await openai.responses.create({
      model: 'gpt-5.6',
      input: `Translate the following text into natural English.

Return only the translated text.

Text:
${text}`,
    });

    await respond({
      response_type: 'in_channel',
      text: `From <@${command.user_id}>:\n${response.output_text}`,
    });
  } catch (error) {
    console.error('English translation error:', error);

    await respond({
      response_type: 'ephemeral',
      text: 'Translation failed. Please try again.',
    });
  }
});

app.command('/korean', async ({ command, ack, respond }) => {
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
    const response = await openai.responses.create({
      model: 'gpt-5.6',
      input: `Translate the following text into natural Korean.

Return only the translated text.

Text:
${text}`,
    });

    await respond({
      response_type: 'in_channel',
      text: `From <@${command.user_id}>:\n${response.output_text}`,
    });
  } catch (error) {
    console.error('Korean translation error:', error);

    await respond({
      response_type: 'ephemeral',
      text: 'Translation failed. Please try again.',
    });
  }
});

app.command('/englishdraft', async ({ command, ack, client, respond }) => {
  await ack();

  const text = command.text.trim();

  if (!text) {
    await respond({
      response_type: 'ephemeral',
      text: 'Please enter some text after /englishdraft.',
    });
    return;
  }

  // Open the modal immediately before Slack's trigger expires
  const modal = await client.views.open({
    trigger_id: command.trigger_id,

    view: {
      type: 'modal',
      callback_id: 'englishdraft_submit',

      private_metadata: JSON.stringify({
        channel: command.channel_id,
        user: command.user_id,
      }),

      title: {
        type: 'plain_text',
        text: 'English Draft',
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
    const response = await openai.responses.create({
      model: 'gpt-5.6',

      input: `Translate the following text into natural English.

Preserve:
- meaning
- tone
- names
- URLs
- Slack mentions
- formatting

Return only the translated text.

Text:
${text}`,
    });

    const translation = response.output_text.trim();

    await client.views.update({
      view_id: modal.view.id,

      view: {
        type: 'modal',
        callback_id: 'englishdraft_submit',

        private_metadata: JSON.stringify({
          channel: command.channel_id,
          user: command.user_id,
        }),

        title: {
          type: 'plain_text',
          text: 'English Draft',
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
    console.error('English draft translation error:', error);

    await client.views.update({
      view_id: modal.view.id,

      view: {
        type: 'modal',
        title: {
          type: 'plain_text',
          text: 'English Draft',
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
});

app.command('/englishdraft', async ({ command, ack, client, respond }) => {
  await ack();

  const text = command.text.trim();

  if (!text) {
    await respond({
      response_type: 'ephemeral',
      text: 'Please enter some text after /englishdraft.',
    });
    return;
  }

  // Open modal immediately before Slack's trigger expires
  const modal = await client.views.open({
    trigger_id: command.trigger_id,

    view: {
      type: 'modal',
      callback_id: 'englishdraft_submit',

      private_metadata: JSON.stringify({
        response_url: command.response_url,
        user: command.user_id,
      }),

      title: {
        type: 'plain_text',
        text: 'English Draft',
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
    const response = await openai.responses.create({
      model: 'gpt-5.6',

      input: `Translate the following text into natural English.

Preserve:
- meaning
- tone
- names
- URLs
- Slack mentions
- formatting

Return only the translated text.

Text:
${text}`,
    });

    const translation = response.output_text.trim();

    await client.views.update({
      view_id: modal.view.id,

      view: {
        type: 'modal',
        callback_id: 'englishdraft_submit',

        private_metadata: JSON.stringify({
          response_url: command.response_url,
          user: command.user_id,
        }),

        title: {
          type: 'plain_text',
          text: 'English Draft',
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
    console.error('English draft translation error:', error);

    await client.views.update({
      view_id: modal.view.id,

      view: {
        type: 'modal',

        title: {
          type: 'plain_text',
          text: 'English Draft',
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
});

app.view('englishdraft_submit', async ({ ack, view }) => {
  await ack();

  const metadata = JSON.parse(view.private_metadata);

  const editedTranslation = view.state.values.translation.text.value.trim();

  if (!editedTranslation) {
    return;
  }

  try {
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
      console.error('Slack post failed:', response.status, errorText);
    }
  } catch (error) {
    console.error('English draft post error:', error);
  }
});

// --------------------------------------------------
// START APP
// --------------------------------------------------

(async () => {
  await app.start();

  console.log('⚡ Slack Translator is running!');
})();
