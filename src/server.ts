import { config } from "dotenv";
config();

import express from "express";
import { google } from "googleapis";
import { bot } from "./bot";
import logger from "./logger";

import {
  getAuthenticatedClient,
  getTokensFromCode,
  saveUserData,
} from "./services/googleAuth";
import { createSpreadsheet } from "./services/googleSheet";

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.get("/oauth2callback", async (req, res) => {
  const { code, state } = req.query;
  const telegramId = state ? parseInt(state as string, 10) : null;

  if (!code || !telegramId) {
    return res.status(400).send("Missing code or state");
  }

  try {
    const tokens = await getTokensFromCode(code as string);
    const authClient = await getAuthenticatedClient(telegramId);
    if (!authClient) {
      throw new Error("Gagal bikin authenticated client setelah dapet token.");
    }
    authClient.setCredentials(tokens);
    // ==========================================================

    const spreadsheetId = await createSpreadsheet(
      authClient,
      "Laporan Keuangan (Bot)"
    );

    if (!spreadsheetId) throw new Error("Gagal membuat spreadsheet");

    const oauth2 = google.oauth2({ version: "v2", auth: authClient });
    const userInfo = await oauth2.userinfo.get();
    const userEmail = userInfo.data.email;

    if (userEmail) {
      const drive = google.drive({ version: "v3", auth: authClient });
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: {
          role: "writer",
          type: "user",
          emailAddress: userEmail,
        },
      });
      logger.info(
        `Akses editor diberikan ke ${userEmail} untuk sheet ${spreadsheetId}`
      );
    }

    await saveUserData(telegramId, { spreadsheetId, tokens });

    await bot.telegram.sendMessage(
      telegramId,
      "✅ Akun Anda berhasil terhubung dan file laporan telah dibuat! Anda sekarang memiliki akses edit. Silakan ketik /start lagi."
    );

    res.send(
      "Otentikasi berhasil! Anda bisa menutup halaman ini dan kembali ke Telegram."
    );
  } catch (error: any) {
    logger.error(error, "Error during OAuth2 callback");

    if (telegramId) {
      await bot.telegram.sendMessage(
        telegramId,
        `Gagal terhubung dengan Google. 😞\n\n*Penyebab:* ${error.message}\n\nSilakan coba lagi dengan mengetik /start. Pastikan Anda sudah menghapus akses bot di akun Google Anda sebelum mencoba lagi.`,
        { parse_mode: "Markdown" }
      );
    }

    res
      .status(500)
      .send(
        "Terjadi kesalahan saat otentikasi. Silakan cek bot Telegram Anda untuk detail."
      );
  }
});

const commands = [
  { command: "start", description: "Hubungkan akun atau lihat bantuan" },
  { command: "help", description: "Tampilkan menu bantuan" },
  { command: "pemasukan", description: "Catat pemasukan bulanan" },
  { command: "catat", description: "Catat pengeluaran harian" },
  { command: "total", description: "Cek ringkasan keuangan bulan ini" },
  { command: "laporan", description: "Dapatkan link Google Sheet pribadi" },
];

const secretPath = `/telegraf/${bot.secretPathComponent()}`;
app.use(bot.webhookCallback(secretPath));

app.listen(port, async () => {
  logger.info(`Server berjalan di port ${port}`);
  try {
    await bot.telegram.setMyCommands(commands);
    logger.info("Menu commands berhasil diatur.");

    const webhookUrl = `${process.env.SERVER_URL}${secretPath}`;
    await bot.telegram.setWebhook(webhookUrl);
    const me = await bot.telegram.getMe();
    logger.info(`Webhook berhasil di-set ke: ${webhookUrl}`);
    logger.info(`Bot berjalan sebagai @${me.username}`);
  } catch (error) {
    logger.error(error, "Gagal mengatur webhook atau mengambil info bot");
  }
});
