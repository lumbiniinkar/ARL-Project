import Fastify from "fastify";
import { trayRoutes } from "./routes/trays.js";
import { batchRoutes } from "./routes/batches.js";
import { reportRoutes } from "./routes/reports.js";

const app = Fastify({
  logger: true,
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