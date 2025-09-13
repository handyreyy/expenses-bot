import { Router } from "express";
import { bot } from "../bot";
import { SERVER_URL, WEBHOOK_PATH } from "../config";
import logger from "../logger";

const router = Router();

// Debug webhook
router.get("/debug/webhook", (_req, res) => {
  res.json({
    base: SERVER_URL,
    secretPath: WEBHOOK_PATH,
    expectedWebhookUrl: `${SERVER_URL}${WEBHOOK_PATH}`,
  });
});

// Log semua metode (biar keliatan kalau dipanggil)
router.all(WEBHOOK_PATH, (req, _res, next) => {
  logger.info(
    { method: req.method, path: req.originalUrl, url: req.url },
    "Incoming Telegram webhook"
  );
  next();
});

// GET → OK (kadang ada probe)
router.get(WEBHOOK_PATH, (_req, res) => res.status(200).send("OK"));

// POST → serahkan ke Telegraf
router.post(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));

export default router;
