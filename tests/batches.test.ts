import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { pool } from "../src/db.js";
import { trayRoutes } from "../src/routes/trays.js";
import { batchRoutes } from "../src/routes/batches.js";

const app = Fastify();

beforeAll(async () => {
  await app.register(trayRoutes);
  await app.register(batchRoutes);
});

beforeEach(async () => {
  // Clear test data so every test starts with a clean database.
  await pool.query("DELETE FROM idempotency_keys");
  await pool.query("DELETE FROM harvests");
  await pool.query("DELETE FROM batches");
  await pool.query("DELETE FROM trays");

  // Create one tray for the tests.
  await pool.query(
    `INSERT INTO trays (id, code, zone, capacity_units)
     VALUES (gen_random_uuid(), 'TEST-TRAY', 'TEST-ZONE', 100)`
  );
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function getTestTrayId() {
  const result = await pool.query(
    "SELECT id FROM trays WHERE code = 'TEST-TRAY'"
  );

  return result.rows[0].id;
}

async function createTestBatch() {
  const trayId = await getTestTrayId();

  const response = await app.inject({
    method: "POST",
    url: "/batches",
    payload: {
      tray_id: trayId,
      crop: "Lettuce",
      seeded_on: "2026-09-29",
      expected_harvest_on: "2026-10-20",
    },
  });

  return {
    response,
    batch: response.json(),
  };
}

describe("Batch business rules", () => {
  it("rejects a second active batch on the same tray", async () => {
    await createTestBatch();

    const { response: secondResponse } = await createTestBatch();

    expect(secondResponse.statusCode).toBe(409);
  });

  it("allows only one stage forward at a time", async () => {
    const { batch } = await createTestBatch();

    const response = await app.inject({
      method: "PATCH",
      url: `/batches/${batch.id}/stage`,
      payload: {
        stage: "GROWING",
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it("rejects harvesting unless the batch is HARVEST_READY", async () => {
    const { batch } = await createTestBatch();

    const response = await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      headers: {
        "Idempotency-Key": "test-harvest-not-ready",
      },
      payload: {
        harvested_on: "2026-10-20",
        weight_grams: 500,
        grade: "A",
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it("records harvest, marks batch as HARVESTED, and frees the tray", async () => {
    const { batch } = await createTestBatch();

    for (const stage of ["GERMINATION", "GROWING", "HARVEST_READY"]) {
      const response = await app.inject({
        method: "PATCH",
        url: `/batches/${batch.id}/stage`,
        payload: { stage },
      });

      expect(response.statusCode).toBe(200);
    }

    const harvestResponse = await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      headers: {
        "Idempotency-Key": "test-harvest-1",
      },
      payload: {
        harvested_on: "2026-10-20",
        weight_grams: 500,
        grade: "A",
      },
    });

    expect(harvestResponse.statusCode).toBe(201);
    expect(harvestResponse.json().batch.stage).toBe("HARVESTED");

    const secondBatchResponse = await createTestBatch();

    expect(secondBatchResponse.response.statusCode).toBe(201);
  });

  it("returns the original result when the same idempotency key is retried", async () => {
    const { batch } = await createTestBatch();

    for (const stage of ["GERMINATION", "GROWING", "HARVEST_READY"]) {
      const response = await app.inject({
        method: "PATCH",
        url: `/batches/${batch.id}/stage`,
        payload: { stage },
      });

      expect(response.statusCode).toBe(200);
    }

    const payload = {
      harvested_on: "2026-10-20",
      weight_grams: 500,
      grade: "A",
    };

    const firstResponse = await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      headers: {
        "Idempotency-Key": "retry-test-1",
      },
      payload,
    });

    const secondResponse = await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      headers: {
        "Idempotency-Key": "retry-test-1",
      },
      payload,
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    expect(secondResponse.json()).toEqual(firstResponse.json());

    const harvestCount = await pool.query(
      "SELECT COUNT(*) FROM harvests WHERE batch_id = $1",
      [batch.id]
    );

    expect(Number(harvestCount.rows[0].count)).toBe(1);
  });

  it("allows exactly one batch when two requests arrive concurrently", async () => {
    const trayId = await getTestTrayId();

    const request1 = app.inject({
      method: "POST",
      url: "/batches",
      payload: {
        tray_id: trayId,
        crop: "Lettuce",
        seeded_on: "2026-09-29",
        expected_harvest_on: "2026-10-20",
      },
    });

    const request2 = app.inject({
      method: "POST",
      url: "/batches",
      payload: {
        tray_id: trayId,
        crop: "Spinach",
        seeded_on: "2026-09-29",
        expected_harvest_on: "2026-10-20",
      },
    });

    // Start both requests without waiting for either one first.
    const [response1, response2] = await Promise.all([
      request1,
      request2,
    ]);

    const statuses = [
      response1.statusCode,
      response2.statusCode,
    ].sort();

    expect(statuses).toEqual([201, 409]);

    const batchCount = await pool.query(
      "SELECT COUNT(*) FROM batches WHERE tray_id = $1",
      [trayId]
    );

    expect(Number(batchCount.rows[0].count)).toBe(1);
  });
});
