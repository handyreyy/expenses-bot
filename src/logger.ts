import pino from "pino";

// Konfigurasi untuk development, agar log mudah dibaca
const transport = pino.transport({
  target: "pino-pretty",
  options: { colorize: true },
});

// Gunakan transport saat bukan di lingkungan produksi
const logger = pino(
  {
    level: "info", // Level log minimum yang akan ditampilkan
    base: {
      pid: false, // Tidak perlu menampilkan process id
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  },
  // Hanya gunakan 'pino-pretty' saat development
  process.env.NODE_ENV !== "production" ? transport : undefined
);

export default logger;
