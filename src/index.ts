// src/index.ts
import { config } from "dotenv";
config();

import type { VercelRequest, VercelResponse } from "@vercel/node";
import express from "express";
import { google } from "googleapis";
import { bot } from "./bot";
import logger from "./logger";
import {
  createNewAuthenticatedClient,
  saveUserData,
} from "./services/googleAuth";
import { createSpreadsheet } from "./services/googleSheet";

const app = express();
app.use(express.json());

// --------------------------------------------------------
// Router dengan prefix /api (semua endpoint kita di sini)
// --------------------------------------------------------
const api = express.Router();

// --------------- Healthcheck ----------------------------
api.get("/ping", (_req, res) => res.status(200).send("Pong! Server idup!"));

// --------------- OAuth callback -------------------------
api.get("/oauth2callback", async (req, res) => {
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
      logger.info({ userEmail }, "Akses editor diberikan");
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

// --------------------------------------------------------
// Webhook Telegram: gunakan secret path yang TETAP dari ENV
// --------------------------------------------------------
const WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET || "local-dev-secret";
const secretPath = `/telegraf/${WEBHOOK_SECRET}`;

// (opsional) endpoint debug untuk memastikan URL webhook yang diharapkan
api.get("/debug/webhook", (_req, res) => {
  const base = (process.env.SERVER_URL || "").replace(/\/$/, "");
  res.json({
    base,
    secretPath,
    expectedWebhookUrl: `${base}${secretPath}`,
  });
});

// log setiap hit webhook, lalu teruskan ke telegraf
api.use(
  secretPath,
  (req, _res, next) => {
    logger.info(
      { method: req.method, path: req.originalUrl },
      "Incoming Telegram webhook"
    );
    next();
  },
  bot.webhookCallback(secretPath)
);

// --------------------------------------------------------
// Pasang router /api ke app utama
// --------------------------------------------------------
app.use("/api", api);

// --------------------------------------------------------
// Setup bot: set commands + setWebhook ke URL yang benar
// (tetap di FILE INI, dipanggil saat function “bangun”)
// --------------------------------------------------------
const commands = [
  { command: "start", description: "Hubungkan akun atau lihat bantuan" },
  { command: "help", description: "Tampilkan menu bantuan" },
  { command: "pemasukan", description: "Catat pemasukan bulanan" },
  { command: "catat", description: "Catat pengeluaran harian" },
  { command: "total", description: "Cek ringkasan keuangan bulan ini" },
  { command: "laporan", description: "Dapatkan link Google Sheet pribadi" },
];

async function setupBot() {
  try {
    await bot.telegram.setMyCommands(commands);

    // SERVER_URL harus: https://<domain-vercel>/api (tanpa slash di belakang)
    const base = (process.env.SERVER_URL || "").replace(/\/$/, "");
    const webhookUrl = `${base}${secretPath}`;

    // drop pending updates lama biar bersih
    await bot.telegram.setWebhook(webhookUrl, { drop_pending_updates: true });

    const me = await bot.telegram.getMe();
    logger.info({ webhookUrl }, "Webhook diset");
    logger.info(`Bot berjalan sebagai @${me.username}`);
  } catch (error) {
    logger.error(error, "Gagal mengatur webhook/getMe");
  }
}
setupBot();

// --------------------------------------------------------
// Vercel entrypoint (jangan .listen di Vercel)
// --------------------------------------------------------
export default function handler(req: VercelRequest, res: VercelResponse) {
  return (app as any)(req, res);
}

// --------------------------------------------------------
// Dev lokal opsional (npm run dev)
// --------------------------------------------------------
if (!process.env.VERCEL && require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => logger.info(`Dev server on http://localhost:${port}`));
}
