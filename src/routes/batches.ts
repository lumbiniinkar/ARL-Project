import { FastifyInstance } from "fastify";
import { CreateBatchSchema } from "../schemas/batch.js";
import { StageSchema } from "../schemas/stage.js";
import { HarvestSchema } from "../schemas/harvest.js";
import { BatchQuerySchema } from "../schemas/batchQuery.js";
import { pool } from "../db.js";

export async function batchRoutes(app: FastifyInstance) {
  // Create a new batch and assign it to an available tray.
  app.post(
    "/batches",
    {
      schema: {
        body: CreateBatchSchema,
      },
    },
    async (request, reply) => {
      const body = request.body as {
        tray_id: string;
        crop: string;
        seeded_on: string;
        expected_harvest_on: string;
      };

      // Rule: the referenced tray must exist.
      const trayResult = await pool.query(
        "SELECT id FROM trays WHERE id = $1",
        [body.tray_id]
      );

      if (trayResult.rows.length === 0) {
        return reply.status(404).send({
          error: "NOT_FOUND",
          message: "Tray not found",
        });
      }

      // Rule: a tray can contain only one active batch.
      const activeBatchResult = await pool.query(
        `SELECT id
         FROM batches
         WHERE tray_id = $1
           AND stage <> 'HARVESTED'`,
        [body.tray_id]
      );

      if (activeBatchResult.rows.length > 0) {
        return reply.status(409).send({
          error: "CONFLICT",
          message: "Tray already has an active batch",
        });
      }

      // The database unique index also protects this rule against
      // concurrent requests.
      let result;

      try {
        result = await pool.query(
          `INSERT INTO batches (
            id,
            tray_id,
            crop,
            seeded_on,
            stage,
            expected_harvest_on
          )
          VALUES (
            gen_random_uuid(),
            $1,
            $2,
            $3,
            'SEEDED',
            $4
          )
          RETURNING *`,
          [
            body.tray_id,
            body.crop,
            body.seeded_on,
            body.expected_harvest_on,
          ]
        );
      } catch (error: any) {
        if (
          error.code === "23505" &&
          error.constraint === "one_active_batch_per_tray"
        ) {
          return reply.status(409).send({
            error: "CONFLICT",
            message: "Tray already has an active batch",
          });
        }

        throw error;
      }

      return reply.status(201).send(result.rows[0]);
    }
  );

  // Get batches with optional filters and pagination.
  app.get(
    "/batches",
    {
      schema: {
        querystring: BatchQuerySchema,
      },
    },
    async (request, reply) => {
      const query = request.query as {
        stage?: string;
        crop?: string;
        zone?: string;
        page?: number;
        limit?: number;
      };

      const page = query.page ?? 1;
      const limit = query.limit ?? 12;
      const offset = (page - 1) * limit;

      const conditions: string[] = [];
      const values: string[] = [];

      if (query.stage) {
        values.push(query.stage);
        conditions.push(`b.stage = $${values.length}`);
      }

      if (query.crop) {
        values.push(query.crop);
        conditions.push(`b.crop = $${values.length}`);
      }

      if (query.zone) {
        values.push(query.zone);
        conditions.push(`t.zone = $${values.length}`);
      }

      const whereClause =
        conditions.length > 0
          ? `WHERE ${conditions.join(" AND ")}`
          : "";

      // Count matching records for pagination metadata.
      const countResult = await pool.query(
        `SELECT COUNT(*)
         FROM batches b
         JOIN trays t ON t.id = b.tray_id
         ${whereClause}`,
        values
      );

      const total = Number(countResult.rows[0].count);

      // Fetch the requested page.
      const result = await pool.query(
        `SELECT
           b.*,
           t.code AS tray_code,
           t.zone
         FROM batches b
         JOIN trays t ON t.id = b.tray_id
         ${whereClause}
         ORDER BY b.seeded_on DESC, b.id
         LIMIT $${values.length + 1}
         OFFSET $${values.length + 2}`,
        [...values, limit.toString(), offset.toString()]
      );

      return reply.send({
        data: result.rows,
        pagination: {
          page,
          limit,
          total,
          total_pages: Math.ceil(total / limit),
        },
      });
    }
  );

  // Move a batch exactly one stage forward.
  app.patch(
    "/batches/:id/stage",
    {
      schema: {
        body: StageSchema,
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const { stage } = request.body as {
        stage:
        | "SEEDED"
        | "GERMINATION"
        | "GROWING"
        | "HARVEST_READY"
        | "HARVESTED";
      };

      const result = await pool.query(
        "SELECT * FROM batches WHERE id = $1",
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "NOT_FOUND",
          message: "Batch not found",
        });
      }

      const batch = result.rows[0];

      // HARVESTED is reached only through the harvest endpoint.
      if (stage === "HARVESTED") {
        return reply.status(409).send({
          error: "CONFLICT",
          message: "Use the harvest endpoint to mark a batch as HARVESTED",
        });
      }

      const stageOrder = [
        "SEEDED",
        "GERMINATION",
        "GROWING",
        "HARVEST_READY",
      ];

      const currentIndex = stageOrder.indexOf(batch.stage);
      const newIndex = stageOrder.indexOf(stage);

      // Stage must move exactly one step forward.
      if (newIndex !== currentIndex + 1) {
        return reply.status(409).send({
          error: "CONFLICT",
          message: "Batch stage must move forward one step at a time",
        });
      }

      const updated = await pool.query(
        `UPDATE batches
         SET stage = $1
         WHERE id = $2
         RETURNING *`,
        [stage, id]
      );

      return updated.rows[0];
    }
  );

  // Restricted correction: move a batch exactly one stage backward.
  app.patch(
    "/batches/:id/stage/correction",
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const body = request.body as {
        stage: string;
        authorization_code: string;
      };

      const AUTHORIZATION_CODE = "123";

      // Require the authorization code.
      if (body.authorization_code !== AUTHORIZATION_CODE) {
        return reply.status(403).send({
          error: "FORBIDDEN",
          message: "Invalid authorization code",
        });
      }

      const result = await pool.query(
        "SELECT * FROM batches WHERE id = $1",
        [id]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: "NOT_FOUND",
          message: "Batch not found",
        });
      }

      const batch = result.rows[0];

      // Harvested batches cannot be moved backward.
      if (batch.stage === "HARVESTED") {
        return reply.status(409).send({
          error: "CONFLICT",
          message: "HARVESTED batches cannot be moved backward",
        });
      }

      const stageOrder = [
        "SEEDED",
        "GERMINATION",
        "GROWING",
        "HARVEST_READY",
      ];

      const currentIndex = stageOrder.indexOf(batch.stage);
      const targetIndex = stageOrder.indexOf(body.stage);

      // Target stage must be exactly one step backward.
      if (
        currentIndex <= 0 ||
        targetIndex !== currentIndex - 1
      ) {
        return reply.status(409).send({
          error: "CONFLICT",
          message: "Stage correction can only move back one step",
        });
      }

      const updated = await pool.query(
        `UPDATE batches
         SET stage = $1
         WHERE id = $2
         RETURNING *`,
        [body.stage, id]
      );

      return updated.rows[0];
    }
  );

  // Record a harvest and support safe retries using an Idempotency-Key.
  app.post(
    "/batches/:id/harvest",
    {
      schema: {
        body: HarvestSchema,
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const idempotencyKey = request.headers["idempotency-key"];

      if (!idempotencyKey || Array.isArray(idempotencyKey)) {
        return reply.status(400).send({
          error: "BAD_REQUEST",
          message: "Idempotency-Key header is required",
        });
      }

      const { harvested_on, weight_grams, grade } = request.body as {
        harvested_on: string;
        weight_grams: number;
        grade: "A" | "B" | "C";
      };

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Check whether this idempotency key was already used.
        const existingKey = await client.query(
          `SELECT response_status, response_body, created_at
           FROM idempotency_keys
           WHERE key = $1`,
          [idempotencyKey]
        );

        if (existingKey.rows.length > 0) {
          const createdAt = new Date(existingKey.rows[0].created_at);
          const ageMs = Date.now() - createdAt.getTime();

          // Same key within 24 hours: return the original response.
          if (ageMs < 24 * 60 * 60 * 1000) {
            await client.query("COMMIT");

            return reply
              .status(existingKey.rows[0].response_status)
              .send(existingKey.rows[0].response_body);
          }

          // Key is older than 24 hours, so allow it to be reused.
          await client.query(
            "DELETE FROM idempotency_keys WHERE key = $1",
            [idempotencyKey]
          );
        }

        // Lock the batch so concurrent harvest requests cannot
        // process the same batch at the same time.
        const batchResult = await client.query(
          `SELECT *
           FROM batches
           WHERE id = $1
           FOR UPDATE`,
          [id]
        );

        if (batchResult.rows.length === 0) {
          await client.query("ROLLBACK");

          return reply.status(404).send({
            error: "NOT_FOUND",
            message: "Batch not found",
          });
        }

        const batch = batchResult.rows[0];

        // Harvesting is allowed only when the batch is ready.
        if (batch.stage !== "HARVEST_READY") {
          await client.query("ROLLBACK");

          return reply.status(409).send({
            error: "CONFLICT",
            message: "Batch must be HARVEST_READY before harvesting",
          });
        }

        // Record the harvest.
        const harvestResult = await client.query(
          `INSERT INTO harvests (
            id,
            batch_id,
            harvested_on,
            weight_grams,
            grade
          )
          VALUES (
            gen_random_uuid(),
            $1,
            $2,
            $3,
            $4
          )
          RETURNING *`,
          [id, harvested_on, weight_grams, grade]
        );

        // Mark the batch as harvested.
        const updatedBatchResult = await client.query(
          `UPDATE batches
           SET stage = 'HARVESTED'
           WHERE id = $1
           RETURNING *`,
          [id]
        );

        const responseBody = {
          batch: updatedBatchResult.rows[0],
          harvest: harvestResult.rows[0],
        };

        // Save the original response so retries with the same key
        // can return exactly the same result.
        await client.query(
          `INSERT INTO idempotency_keys (
            key,
            batch_id,
            response_status,
            response_body
          )
          VALUES ($1, $2, $3, $4)`,
          [idempotencyKey, id, 201, JSON.stringify(responseBody)]
        );

        await client.query("COMMIT");

        return reply.status(201).send(responseBody);
      } catch (error: any) {
        await client.query("ROLLBACK");

        // If another concurrent request stored this key first,
        // return that request's original response.
        if (
          error.code === "23505" &&
          error.constraint === "idempotency_keys_pkey"
        ) {
          const existing = await pool.query(
            `SELECT response_status, response_body
             FROM idempotency_keys
             WHERE key = $1`,
            [idempotencyKey]
          );

          if (existing.rows.length > 0) {
            return reply
              .status(existing.rows[0].response_status)
              .send(existing.rows[0].response_body);
          }
        }

        throw error;
      } finally {
        client.release();
      }
    }
  );
}