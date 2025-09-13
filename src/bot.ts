import { formatInTimeZone } from "date-fns-tz";
import { Markup, Telegraf } from "telegraf";
import logger from "./logger";
import {
  clearUserData,
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

// ====== HELP TEXTS ======
const examples = [
  "• Mulai / bantuan: `/start` atau `/help`",
  "• Hubungkan ulang Google: `/relink`",
  "• Catat pemasukan: `/pemasukan 500k gaji bulanan`",
  "• Catat pengeluaran: `/catat makan 15rb nasi padang`",
  "• Lihat total bulan ini: `/total`",
  "• Buka laporan Sheet: `/laporan`",
].join("\n");

const helpMessageAuthed = `👋 *Selamat datang kembali!*\n\nBot sudah terhubung dengan Google Anda dan siap dipakai.\n\n*Contoh perintah:*\n${examples}`;

const helpMessageNew = (authUrl: string) =>
  `👋 *Selamat datang!*\n\nAgar bisa menyimpan data, hubungkan dulu akun Google Anda ya.\n\n` +
  `1. Ketuk tombol *Hubungkan Akun Google* di bawah.\n` +
  `2. Izinkan akses (Sheets & Drive).\n` +
  `3. Setelah sukses, Anda bisa langsung pakai perintah di bawah.\n\n` +
  `*Contoh perintah:*\n${examples}\n\n` +
  `Atau ketuk tombol cepat di bawah.`;

const keyboardAuthed = Markup.inlineKeyboard([
  [
    Markup.button.switchToCurrentChat("➕ Pengeluaran", "/catat "),
    Markup.button.switchToCurrentChat("💰 Pemasukan", "/pemasukan "),
  ],
  [
    Markup.button.switchToCurrentChat("📊 Total", "/total"),
    Markup.button.switchToCurrentChat("📄 Laporan", "/laporan"),
  ],
  [Markup.button.switchToCurrentChat("🔁 Relink", "/relink")],
]);

const keyboardNew = (authUrl: string) =>
  Markup.inlineKeyboard([
    [Markup.button.url("🔗 Hubungkan Akun Google", authUrl)],
    [
      Markup.button.switchToCurrentChat("➕ Pengeluaran", "/catat "),
      Markup.button.switchToCurrentChat("💰 Pemasukan", "/pemasukan "),
    ],
    [
      Markup.button.switchToCurrentChat("📊 Total", "/total"),
      Markup.button.switchToCurrentChat("📄 Laporan", "/laporan"),
    ],
  ]);

// ====== LOGGING & ERROR HANDLING ======
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

bot.catch((err, ctx) => {
  logger.error({ err: String(err), update: ctx.update }, "Telegraf error");
});

// ====== REGEX COMMANDS ======
const startHelpRegex = /^(?:@\w+\s+)?\/(start|help)(?:@\w+)?\s*$/;
const totalRegex = /^(?:@\w+\s+)?\/total(?:@\w+)?\s*$/;
const laporanRegex = /^(?:@\w+\s+)?\/laporan(?:@\w+)?\s*$/;
const pemasukanRegex = /^(?:@\w+\s+)?\/pemasukan(?:@\w+)?\s*(.*)/s;
const catatRegex = /^(?:@\w+\s+)?\/catat(?:@\w+)?\s*(.*)/s;
const relinkRegex = /^(?:@\w+\s+)?\/relink(?:@\w+)?\s*$/;

// ====== HANDLERS ======
bot.hears(relinkRegex, async (ctx) => {
  const id = ctx.from!.id;
  await clearUserData(id);
  const url = generateAuthUrl(id);
  await ctx.reply(
    "🔁 Data lama dihapus. Silakan hubungkan ulang akun Google Anda.",
    keyboardNew(url)
  );
});

bot.hears(startHelpRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const userData = await getUserData(telegramId);

  if (userData) {
    await ctx.replyWithMarkdown(helpMessageAuthed, keyboardAuthed);
  } else {
    // user pertama kali / belum link → tampilkan onboarding + tombol connect
    const authUrl = generateAuthUrl(telegramId);
    logger.info({ authUrl }, "Generated OAuth URL");
    await ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }
});

bot.hears(totalRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const authClient = await getAuthenticatedClient(telegramId);
  const userData = await getUserData(telegramId);

  if (!authClient || !userData) {
    const authUrl = generateAuthUrl(telegramId);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
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
  } catch (error: any) {
    const detail =
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown error";
    logger.error(
      { user: ctx.from, err: error?.response?.data ?? detail },
      "Gagal mengambil total laporan"
    );
    await ctx.reply(
      `Maaf, terjadi kesalahan saat mengambil laporan.\n\nDetail: \`${detail}\``
    );
  }
});

bot.hears(laporanRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const userData = await getUserData(telegramId);

  if (!userData) {
    const authUrl = generateAuthUrl(telegramId);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
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
    const authUrl = generateAuthUrl(telegramId);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
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
      )}* sudah dicatat.\n\nTotal pemasukan bulan ini: *Rp${totalIncome.toLocaleString(
        "id-ID"
      )}*`
    );
  } catch (error: any) {
    const detail =
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown error";
    logger.error(
      { user: ctx.from, err: error?.response?.data ?? detail },
      "Gagal mencatat pemasukan"
    );
    await ctx.reply(
      `Terjadi kesalahan saat mencatat ke Google Sheet. 😞\n\nDetail: \`${detail}\``
    );
  }
});

bot.hears(catatRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const authClient = await getAuthenticatedClient(telegramId);
  const userData = await getUserData(telegramId);

  if (!authClient || !userData) {
    const authUrl = generateAuthUrl(telegramId);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
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
          "Silakan catat pemasukan terlebih dahulu:\n`/pemasukan <jumlah> [sumber]`"
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
      `✅ Berhasil! Pengeluaran *${category}* sebesar *Rp${amount.toLocaleString(
        "id-ID"
      )}* sudah dicatat.\n\nSisa saldo bulan ini: *Rp${balance.toLocaleString(
        "id-ID"
      )}*`
    );
  } catch (error: any) {
    const detail =
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown error";
    logger.error(
      { user: ctx.from, err: error?.response?.data ?? detail },
      "Gagal mencatat pengeluaran"
    );
    await ctx.reply(
      `Terjadi kesalahan saat mencatat ke Google Sheet. 😞\n\nDetail: \`${detail}\``
    );
  }
});

bot.on("text", (ctx) => {
  ctx.replyWithMarkdown(helpMessageAuthed, keyboardAuthed);
});

export { bot };
