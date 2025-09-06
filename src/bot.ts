import { formatInTimeZone } from "date-fns-tz";
import { Markup, Telegraf } from "telegraf";
import logger from "./logger";
import {
  generateAuthUrl,
  getAuthenticatedClient,
  getUserData,
} from "./services/googleAuth";
import {
  appendTransaction,
  calculateBalance,
  type TransactionRow,
} from "./services/googleSheet";
import { parseAmount } from "./utils/parser";

const bot = new Telegraf(process.env.BOT_TOKEN!);

const helpMessage = `👋 *Selamat datang kembali!*

Bot sudah terhubung dengan akun Google Anda dan siap digunakan.

Pilih salah satu tombol di bawah untuk memulai, atau ketik perintah secara manual.`;

bot.use(async (ctx, next) => {
  if (ctx.message && "text" in ctx.message) {
    logger.info(
      {
        user_id: ctx.from?.id,
        username: ctx.from?.username,
        message: ctx.message.text,
      },
      "Pesan diterima"
    );
  }
  await next();
});

const startHelpRegex = /^(?:@\w+\s+)?\/(start|help)(?:@\w+)?\s*$/;
const totalRegex = /^(?:@\w+\s+)?\/total(?:@\w+)?\s*$/;
const laporanRegex = /^(?:@\w+\s+)?\/laporan(?:@\w+)?\s*$/;
const pemasukanRegex = /^(?:@\w+\s+)?\/pemasukan(?:@\w+)?\s*(.*)/s;
const catatRegex = /^(?:@\w+\s+)?\/catat(?:@\w+)?\s*(.*)/s;

bot.hears(startHelpRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const userData = await getUserData(telegramId);

  if (userData) {
    await ctx.replyWithMarkdown(
      helpMessage,
      Markup.inlineKeyboard([
        [
          Markup.button.switchToCurrentChat("Pengeluaran", "/catat "),
          Markup.button.switchToCurrentChat("Pemasukan", "/pemasukan "),
        ],
        [
          Markup.button.switchToCurrentChat("Total", "/total"),
          Markup.button.switchToCurrentChat("Laporan", "/laporan"),
        ],
      ])
    );
  } else {
    const authUrl = generateAuthUrl(telegramId);
    await ctx.reply(
      "Selamat datang! Untuk memulai, hubungkan akun Google Anda.",
      Markup.inlineKeyboard([
        Markup.button.url("🔗 Hubungkan Akun Google", authUrl),
      ])
    );
  }
});

bot.hears(totalRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const authClient = await getAuthenticatedClient(telegramId);
  const userData = await getUserData(telegramId);

  if (!authClient || !userData) {
    return ctx.reply("Akun Anda belum terhubung. Ketik /start untuk memulai.");
  }

  try {
    const { totalIncome, totalExpenses, balance } = await calculateBalance(
      authClient,
      userData.spreadsheetId
    );
    const monthName = new Date().toLocaleString("id-ID", { month: "long" });
    const year = new Date().getFullYear();
    const replyMessage = `📊 *Laporan Bulan ${monthName} ${year}*\n\nPemasukan: Rp${totalIncome.toLocaleString(
      "id-ID"
    )}\nPengeluaran: Rp${totalExpenses.toLocaleString(
      "id-ID"
    )}\n--------------------\nSisa Saldo: *Rp${balance.toLocaleString(
      "id-ID"
    )}*`;
    await ctx.replyWithMarkdown(replyMessage);
  } catch (error) {
    logger.error({ user: ctx.from }, "Gagal mengambil total laporan");
    await ctx.reply("Maaf, terjadi kesalahan saat mengambil laporan.");
  }
});

bot.hears(laporanRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const userData = await getUserData(telegramId);

  if (!userData) {
    return ctx.reply("Akun Anda belum terhubung. Ketik /start untuk memulai.");
  }

  const url = `https://docs.google.com/spreadsheets/d/${userData.spreadsheetId}`;
  const replyMessage = `📄 Berikut adalah link laporan Google Sheet Anda:\n\n[Buka Laporan](${url})`;
  ctx.replyWithMarkdown(replyMessage);
});

bot.hears(pemasukanRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const authClient = await getAuthenticatedClient(telegramId);
  const userData = await getUserData(telegramId);

  if (!authClient || !userData) {
    return ctx.reply("Akun Anda belum terhubung. Ketik /start untuk memulai.");
  }

  const text = ctx.match[1].trim();
  if (!text) {
    return ctx.reply("❓ Format salah. Contoh: /pemasukan 500k gaji bulanan");
  }

  const match = text.match(/^([\d.,krbiru\s]+)\s*(.*)$/s);

  if (!match) {
    return ctx.reply("❓ Format salah. Gunakan: /pemasukan <jumlah> [sumber]");
  }

  const [, amountStr, description] = match;
  const amount = parseAmount(amountStr);

  if (isNaN(amount)) {
    return ctx.reply(`❓ Jumlah "${amountStr}" tidak valid.`);
  }

  const incomeData: TransactionRow = {
    timestamp: formatInTimeZone(
      new Date(),
      "Asia/Jakarta",
      "yyyy-MM-dd HH:mm:ss"
    ),
    type: "Pemasukan",
    category: "Pemasukan",
    amount,
    description: description || "-",
  };

  try {
    await appendTransaction(authClient, userData.spreadsheetId, incomeData);
    const { totalIncome } = await calculateBalance(
      authClient,
      userData.spreadsheetId
    );
    await ctx.replyWithMarkdown(
      `✅ Berhasil! Pemasukan sebesar *Rp${amount.toLocaleString(
        "id-ID"
      )}* sudah dicatat.\n\n` +
        `Total pemasukan Anda bulan ini: *Rp${totalIncome.toLocaleString(
          "id-ID"
        )}*`
    );
  } catch (error) {
    logger.error({ user: ctx.from }, "Gagal mencatat pemasukan");
    await ctx.reply("Terjadi kesalahan saat mencatat ke Google Sheet. 😞");
  }
});

bot.hears(catatRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const authClient = await getAuthenticatedClient(telegramId);
  const userData = await getUserData(telegramId);

  if (!authClient || !userData) {
    return ctx.reply("Akun Anda belum terhubung. Ketik /start untuk memulai.");
  }

  const text = ctx.match[1].trim();
  if (!text) {
    return ctx.reply("❓ Format salah. Contoh: /catat makan 15rb nasi padang");
  }

  const match = text.match(/^(\w+)\s+([\d.,krbiru\s]+)\s*(.*)$/s);

  if (!match) {
    return ctx.reply(
      "❓ Format salah. Gunakan: /catat <kategori> <jumlah> [deskripsi]"
    );
  }

  const [, category, amountStr, description] = match;
  const amount = parseAmount(amountStr);

  if (isNaN(amount)) {
    return ctx.reply(`❓ Jumlah "${amountStr}" tidak valid.`);
  }

  try {
    const { totalIncome } = await calculateBalance(
      authClient,
      userData.spreadsheetId
    );

    if (totalIncome <= 0) {
      return ctx.replyWithMarkdown(
        "⛔️ Anda belum memiliki pemasukan bulan ini.\n\n" +
          "Silakan catat pemasukan terlebih dahulu dengan perintah:\n`/pemasukan <jumlah> [sumber]`"
      );
    }

    const expenseData: TransactionRow = {
      timestamp: formatInTimeZone(
        new Date(),
        "Asia/Jakarta",
        "yyyy-MM-dd HH:mm:ss"
      ),
      type: "Pengeluaran",
      category,
      amount,
      description: description || "-",
    };

    await appendTransaction(authClient, userData.spreadsheetId, expenseData);
    const { balance } = await calculateBalance(
      authClient,
      userData.spreadsheetId
    );
    await ctx.replyWithMarkdown(
      `✅ Berhasil! Pengeluaran untuk kategori *${category}* sebesar *Rp${amount.toLocaleString(
        "id-ID"
      )}* sudah dicatat.\n\n` +
        `Sisa saldo Anda bulan ini: *Rp${balance.toLocaleString("id-ID")}*`
    );
  } catch (error) {
    logger.error({ user: ctx.from }, "Gagal mencatat pengeluaran");
    await ctx.reply("Terjadi kesalahan saat mencatat ke Google Sheet. 😞");
  }
});

bot.on("text", (ctx) => {
  ctx.reply("Perintah tidak dikenal. Ketik /help buat liat daftar perintah.");
});

export { bot };
