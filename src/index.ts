import { Context, Markup, Telegraf } from 'telegraf';
import {
  anyOf,
  channelPost,
  editedChannelPost,
  editedMessage,
  message,
} from 'telegraf/filters';
import { toHTML, toMarkdownV2 } from '@telegraf/entity';
import { put } from '@vercel/blob';

import { about } from './commands';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { development, production } from './core';

import createDebug from 'debug';
import {
  getExpiredFiles,
  isChatRegistered,
  updateFileUrl,
  upsertFile,
} from './core/db';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';

const bot = new Telegraf(BOT_TOKEN);

const replyToMessage = (ctx: Context, messageId: number, string: string) =>
  ctx.replyWithMarkdownV2(string, {
    reply_parameters: { message_id: messageId },
  });

bot.command('about', about());
// bot.on(message('text'), async (ctx) => {
//   debug('Triggered "greeting" text command');
//   const messageId = ctx.message?.message_id;

//   if (messageId) {
//     await replyToMessage(
//       ctx,
//       messageId,
//       `Hello, ${ctx.message?.from.first_name}`,
//     );
//   }
// });

// bot.on(channelPost('text'), async (ctx) => {
//   debug('Triggered channel post');

//   const messageId = ctx.channelPost?.message_id;

//   const chat = await ctx.getChat();

//   let photoUrl: string | URL = '';
//   if (chat.photo) {
//     photoUrl = await ctx.telegram.getFileLink(chat.photo?.big_file_id ?? '');
//   }
//   const data = {
//     ...ctx.channelPost,
//     chat: {
//       ...ctx.channelPost.chat,
//       ...chat,
//       photo_url: photoUrl,
//     },
//     markdown: toMarkdownV2(ctx.channelPost),
//     html: toHTML(ctx.channelPost),
//   };
//   console.log('data:', data);

//   const blob = await put(
//     `${data.chat.username || data.chat.id}/data.json`,
//     JSON.stringify(data),
//     { access: 'public', addRandomSuffix: false },
//   );
//   console.log('blob', blob);

//   ctx.editMessageReplyMarkup(
//     Markup.inlineKeyboard([
//       [
//         Markup.button.switchToCurrentChat('Copy', toMarkdownV2(ctx.channelPost)),
//       ],
//     ]).reply_markup,
//   );

//   if (messageId) {
//     await replyToMessage(
//       ctx,
//       messageId,
//       `[Published](https://telegram-microsites.vercel.app/${data.chat.username})`,
//     );
//   }
// });

bot.on(message('text'), async (ctx) => {
  const message = ctx.message;
  if (!message) {
    console.warn('message not found');
    return;
  }
  console.log('received new message or edited text message:', message);

  const originalChatId = Number(String(message.chat.id).slice(4));
  if (!isChatRegistered(originalChatId)) {
    console.warn('chat not registered');
    return;
  }

  if (!message.text.includes('Chat action')) {
    console.warn('message does not contain "Chat action"');
    return;
  }

  const chat = await ctx.getChat();
  if (chat.photo) {
    const fileId = chat.photo.small_file_id;
    const fileUrl = await ctx.telegram.getFileLink(fileId);
    const fileSuccess = await upsertFile(
      fileId,
      fileUrl.toString(),
      'chat_photo',
      originalChatId,
      -1,
    );
    if (!fileSuccess) {
      console.warn('chat photo failed to upload', { chatId: originalChatId });
      return;
    }
    console.log('chat photo successfully uploaded', { chatId: originalChatId });
  }
});

// Handle media messages (photos, videos, documents, audio)
bot.on(
  anyOf(
    message('photo'),
    message('video'),
    message('document'),
    message('audio'),
    editedMessage('photo'),
    editedMessage('video'),
    editedMessage('document'),
    editedMessage('audio'),
    channelPost('photo'),
    channelPost('video'),
    channelPost('document'),
    channelPost('audio'),
    editedChannelPost('photo'),
    editedChannelPost('video'),
    editedChannelPost('document'),
    editedChannelPost('audio'),
  ),
  async (ctx: Context) => {
    const message =
      ctx.message ||
      ctx.editedMessage ||
      ctx.channelPost ||
      ctx.editedChannelPost;
    if (!message) {
      console.warn('message not found');
      return;
    }
    console.log('received new message or edited media message:', message);

    const originalChatId = Number(String(message.chat.id).slice(4));
    if (!isChatRegistered(originalChatId)) {
      console.warn('chat not registered');
      return;
    }

    let fileId: string | undefined;
    let fileType: string = 'unknown';
    // Extract file_id based on media type
    if ('photo' in message) {
      // Get highest-resolution photo (last in the array)
      const photo = message.photo.pop();
      fileId = photo?.file_id;
      fileType = 'photo';
    } else if ('video' in message) {
      fileId = message.video?.file_id;
      fileType = 'video';
    } else if ('document' in message) {
      fileId = message.document?.file_id;
      fileType = 'document';
    } else if ('audio' in message) {
      fileId = message.audio?.file_id;
      fileType = 'audio';
    }

    if (!fileId) {
      console.warn('media not found');
      return;
    }
    let mediaGroupId: string | undefined = undefined;
    if ('media_group_id' in message) {
      mediaGroupId = message.media_group_id;
    }

    const fileUrl = await ctx.telegram.getFileLink(fileId);
    const success = await upsertFile(
      fileId,
      fileUrl.toString(),
      fileType,
      originalChatId,
      message.message_id,
      mediaGroupId,
    );
    if (!success) {
      console.warn('media failed to upload', {
        fileId,
        fileUrl: fileUrl.toString(),
        fileType,
        messageId: message.message_id,
        chatId: originalChatId,
        mediaGroupId,
      });
    }
    console.log('media successfully uploaded', {
      fileId,
      fileUrl: fileUrl.toString(),
      fileType,
      messageId: message.message_id,
      chatId: originalChatId,
      mediaGroupId,
    });
  },
);

export const updateExpiredFiles = async (expiryMinutes: number = 60) => {
  const expiredFiles = await getExpiredFiles(expiryMinutes);
  for (const file of expiredFiles) {
    try {
      const fileUrl = await bot.telegram.getFileLink(file.file_id);
      const success = await updateFileUrl(file.file_id, fileUrl.toString());
      if (!success) {
        throw new Error('database error');
      }
      console.log('successfully updated media url');
    } catch (error) {
      console.warn('failed to update media url:', error);
      continue;
    }
  }
};

//prod mode (Vercel)
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};
//dev mode
ENVIRONMENT !== 'production' && development(bot);
