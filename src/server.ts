import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import { fileURLToPath } from "url";
import { trayRoutes } from "./routes/trays.js";
import { batchRoutes } from "./routes/batches.js";
import { reportRoutes } from "./routes/reports.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({
  logger: true,
});

// Enable CORS for all origins, allowing browser clients or local files to connect smoothly.
await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Idempotency-Key", "Authorization"],
  exposedHeaders: ["Idempotency-Key"],
});

// Serve frontend assets (HTML, CSS, JS) from the public directory.
await app.register(fastifyStatic, {
  root: path.join(__dirname, "../public"),
  prefix: "/",
});

// Simple health check.
app.get("/health", async () => {
  return {
    status: "ok",
  };
});

// Register API routes.
app.register(trayRoutes);
app.register(batchRoutes);
app.register(reportRoutes);

const start = async () => {
  try {
    await app.listen({
      port: 3000,
      host: "0.0.0.0",
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();