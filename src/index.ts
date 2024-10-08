import { Context, Markup, Telegraf } from 'telegraf';
import { channelPost, message } from 'telegraf/filters';
import { toHTML, toMarkdownV2 } from '@telegraf/entity';
import { put } from '@vercel/blob';

import { about } from './commands';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { development, production } from './core';

import createDebug from 'debug';

const debug = createDebug('bot:greeting_text');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';

const bot = new Telegraf(BOT_TOKEN);

const replyToMessage = (ctx: Context, messageId: number, string: string) =>
  ctx.replyWithMarkdownV2(string, {
    reply_parameters: { message_id: messageId },
  });

bot.command('about', about());
bot.on(message('text'), async (ctx) => {
  debug('Triggered "greeting" text command');
  const messageId = ctx.message?.message_id;

  if (messageId) {
    await replyToMessage(
      ctx,
      messageId,
      `Hello, ${ctx.message?.from.first_name}!`,
    );
  }
});

bot.on(channelPost('text'), async (ctx) => {
  debug('Triggered channel post');

  const messageId = ctx.channelPost?.message_id;

  const chat = await ctx.getChat();

  let photoUrl: string | URL = '';
  if (chat.photo) {
    photoUrl = await ctx.telegram.getFileLink(chat.photo?.big_file_id ?? '');
  }
  const data = {
    ...ctx.channelPost,
    chat: {
      ...ctx.channelPost.chat,
      ...chat,
      photo_url: photoUrl,
    },
    markdown: toMarkdownV2(ctx.channelPost),
    html: toHTML(ctx.channelPost),
  };
  console.log('data:', data);

  const blob = await put(
    `${data.chat.username || data.chat.id}/data.json`,
    JSON.stringify(data),
    { access: 'public', addRandomSuffix: false },
  );
  console.log('blob', blob);

  // ctx.editMessageReplyMarkup(
  //   Markup.inlineKeyboard([
  //     [
  //       Markup.button.switchToCurrentChat('Copy', toMarkdownV2(ctx.channelPost)),
  //     ],
  //   ]).reply_markup,
  // );

  if (messageId) {
    await replyToMessage(
      ctx,
      messageId,
      `[Published](https://telegram-microsites.vercel.app/${data.chat.username})`,
    );
  }
});


// bot.on('callback_query', async (ctx) => {
  
//   // Using context shortcut
//   await ctx.answerCbQuery()
// })

//prod mode (Vercel)
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};
//dev mode
ENVIRONMENT !== 'production' && development(bot);
