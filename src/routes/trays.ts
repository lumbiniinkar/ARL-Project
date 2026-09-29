import { FastifyInstance } from "fastify";
import { CreateTraySchema } from "../schemas/tray.js";
import { pool } from "../db.js";

export async function trayRoutes(app: FastifyInstance) {
  // Create a new tray in PostgreSQL.
  app.post(
    "/trays",
    {
      schema: {
        body: CreateTraySchema,
      },
    },
    async (request, reply) => {
      const body = request.body as {
        code: string;
        zone: string;
        capacity_units: number;
      };

      try {
        const result = await pool.query(
          `INSERT INTO trays (id, code, zone, capacity_units)
           VALUES (gen_random_uuid(), $1, $2, $3)
           RETURNING *`,
          [body.code, body.zone, body.capacity_units]
        );

        return reply.status(201).send(result.rows[0]);
      } catch (error: any) {
        // PostgreSQL error 23505 means a UNIQUE constraint was violated.
        if (error.code === "23505") {
          return reply.status(409).send({
            error: "CONFLICT",
            message: `Tray with code ${body.code} already exists`,
          });
        }

        throw error;
      }
    }
  );

  // Get all trays.
  app.get("/trays", async () => {
    const result = await pool.query(
      "SELECT * FROM trays ORDER BY created_at"
    );

    return result.rows;
  });

  // Get one tray by ID.
  app.get("/trays/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const result = await pool.query(
      "SELECT * FROM trays WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({
        error: "NOT_FOUND",
        message: "Tray not found",
      });
    }

    return result.rows[0];
  });
}