import { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { pool } from "../db.js";

// Validates filters for the yield report.
const YieldQuerySchema = Type.Object({
  from: Type.Optional(Type.String({ minLength: 1 })),
  to: Type.Optional(Type.String({ minLength: 1 })),
  group_by: Type.Union([
    Type.Literal("crop"),
    Type.Literal("zone"),
  ]),
});

export async function reportRoutes(app: FastifyInstance) {
  // Returns harvested yield grouped by crop or zone.
  app.get(
    "/reports/yield",
    {
      schema: {
        querystring: YieldQuerySchema,
      },
    },
    async (request, reply) => {
      const query = request.query as {
        from?: string;
        to?: string;
        group_by: "crop" | "zone";
      };

      // Validate that both dates are provided together.
      if ((query.from && !query.to) || (!query.from && query.to)) {
        return reply.status(400).send({
          error: "BAD_REQUEST",
          message: "Both from and to dates must be provided together",
        });
      }

      // Validate the date range.
      if (query.from && query.to && query.from > query.to) {
        return reply.status(400).send({
          error: "BAD_REQUEST",
          message: "from date cannot be after to date",
        });
      }

      const values: string[] = [];
      const conditions: string[] = [
        "b.stage = 'HARVESTED'",
      ];

      if (query.from) {
        values.push(query.from);
        conditions.push(`h.harvested_on >= $${values.length}`);
      }

      if (query.to) {
        values.push(query.to);
        conditions.push(`h.harvested_on <= $${values.length}`);
      }

      // Select the grouping column based on group_by.
      const groupColumn =
        query.group_by === "crop"
          ? "b.crop"
          : "t.zone";

      const result = await pool.query(
        `SELECT
           ${groupColumn} AS group_value,
           SUM(h.weight_grams) AS total_weight_grams,
           COUNT(DISTINCT b.id) AS harvested_batch_count,
           ROUND(
             AVG(h.harvested_on - b.seeded_on),
             2
           ) AS avg_days_seeded_to_harvest
         FROM batches b
         INNER JOIN harvests h
           ON h.batch_id = b.id
         INNER JOIN trays t
           ON t.id = b.tray_id
         WHERE ${conditions.join(" AND ")}
         GROUP BY ${groupColumn}
         ORDER BY ${groupColumn}`,
        values
      );

      return reply.send({
        group_by: query.group_by,
        from: query.from ?? null,
        to: query.to ?? null,
        data: result.rows,
      });
    }
  );
}