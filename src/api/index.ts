// api/index.ts
import { config } from "dotenv";
config();

import express from "express";
import { google } from "googleapis";
import { bot } from "../../src/bot"; // perbarui path sesuai struktur kamu
import logger from "../../src/logger";
import {
  createNewAuthenticatedClient,
  saveUserData,
} from "../../src/services/googleAuth";
import { createSpreadsheet } from "../../src/services/googleSheet";

const app = express();
app.use(express.json());

// healthcheck
app.get("/ping", (_req, res) => res.status(200).send("Pong! Server idup!"));

// NOTE: sekarang callback OAuth di /api/oauth2callback
app.get("/oauth2callback", async (req, res) => {
  const { code, state } = req.query;
  const telegramId = state ? parseInt(state as string, 10) : null;

  if (!code || !telegramId)
    return res.status(400).send("Missing code or state");

  try {
    const { authClient, tokens } = await createNewAuthenticatedClient(
      code as string
    );
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
        requestBody: { role: "writer", type: "user", emailAddress: userEmail },
      });
      logger.info(`Akses editor diberikan ke ${userEmail}`);
    }

    await saveUserData(telegramId, { spreadsheetId, tokens });
    await bot.telegram.sendMessage(
      telegramId,
      "✅ Akun Anda berhasil terhubung! Silakan ketik /start lagi."
    );
    res.send("Otentikasi berhasil! Anda bisa menutup halaman ini.");
  } catch (error: any) {
    logger.error(error, "Error during OAuth2 callback");
    if (telegramId) {
      await bot.telegram.sendMessage(
        telegramId,
        `Gagal terhubung dengan Google. 😞\n\n*Penyebab:* ${error.message}`
      );
    }
    res.status(500).send("Terjadi kesalahan. Cek bot Telegram Anda.");
  }
});

// --- Telegram webhook
const commands = [
  { command: "start", description: "Hubungkan akun atau lihat bantuan" },
  { command: "help", description: "Tampilkan menu bantuan" },
  { command: "pemasukan", description: "Catat pemasukan bulanan" },
  { command: "catat", description: "Catat pengeluaran harian" },
  { command: "total", description: "Cek ringkasan keuangan bulan ini" },
  { command: "laporan", description: "Dapatkan link Google Sheet pribadi" },
];

const secretPath = `/telegraf/${bot.secretPathComponent()}`;

async function setupBot() {
  try {
    await bot.telegram.setMyCommands(commands);

    // PENTING: SERVER_URL HARUS menyertakan '/api' (tanpa trailing slash)
    // contoh: https://expenses-bot-rho.vercel.app/api
    const base = process.env.SERVER_URL!;
    const webhookUrl = `${base}${secretPath}`;
    await bot.telegram.setWebhook(webhookUrl);

    const me = await bot.telegram.getMe();
    logger.info(`Webhook di-set ke: ${webhookUrl}`);
    logger.info(`Bot berjalan sebagai @${me.username}`);
  } catch (error) {
    logger.error(error, "Gagal mengatur webhook atau mengambil info bot");
  }
}
setupBot();

// pasang handler webhook di path yang sama
app.use(secretPath, bot.webhookCallback(secretPath));

// Vercel butuh default export of a handler
export default app;
