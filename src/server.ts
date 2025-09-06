// src/server.ts
import { config } from "dotenv";
config();

import express from "express";
import { google } from "googleapis";
import { bot } from "./bot";
import logger from "./logger";
import { saveUserData } from "./services/googleAuth"; // <-- Cuma butuh ini
import { createSpreadsheet } from "./services/googleSheet";

// Kita baca credentials di sini biar bisa bikin asisten yang bener
const credentials = require("../credentials.json");

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());

app.get("/oauth2callback", async (req, res) => {
  const { code, state } = req.query;
  // Ambil telegramId di awal biar bisa ngirim pesan error
  const telegramId = state ? parseInt(state as string, 10) : null;

  if (!code || !telegramId) {
    return res.status(400).send("Missing code or state");
  }

  try {
    // 1. Bikin asisten baru yang lengkap dengan KTP (credentials)
    const { client_secret, client_id, redirect_uris } = credentials.web;
    const authClient = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    // 2. Suruh asisten ini buat nuker 'code' jadi 'tokens'
    const { tokens } = await authClient.getToken(code as string);

    // ==========================================================
    // PERBAIKAN UTAMA: PAKSA ASISTEN BUAT PAKE TOKENNYA
    // ==========================================================
    authClient.setCredentials(tokens);
    // ==========================================================

    // 3. Sekarang asisten ini udah siap kerja
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

    // KIRIM PESAN ERROR KE USER DI TELEGRAM
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
