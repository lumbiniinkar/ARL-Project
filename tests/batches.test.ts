import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
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

describe("Tray API tests", () => {
  // TEST 1: Get all trays
  it("returns all trays", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/trays",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().length).toBe(1);
    expect(response.json()[0].code).toBe("TEST-TRAY");
  });

  // TEST 2: Get one tray by ID
  it("returns a tray by ID", async () => {
    const trayId = await getTestTrayId();

    const response = await app.inject({
      method: "GET",
      url: `/trays/${trayId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(trayId);
    expect(response.json().code).toBe("TEST-TRAY");
  });

  // TEST 3: Return 404 when tray does not exist
  it("returns 404 when the tray does not exist", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/trays/00000000-0000-0000-0000-000000000000",
    });

    expect(response.statusCode).toBe(404);
  });

  // TEST 4: Reject duplicate tray code
  it("rejects a duplicate tray code", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/trays",
      payload: {
        code: "TEST-TRAY",
        zone: "ZONE-B",
        capacity_units: 50,
      },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe("Batch API tests", () => {
  // TEST 5: Reject a second active batch on the same tray
  it("rejects a second active batch on the same tray", async () => {
    await createTestBatch();

    const { response: secondResponse } = await createTestBatch();

    expect(secondResponse.statusCode).toBe(409);
  });

  // TEST 6: Reject batch creation when tray does not exist
  it("rejects batch creation when the tray does not exist", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/batches",
      payload: {
        tray_id: "00000000-0000-0000-0000-000000000000",
        crop: "Lettuce",
        seeded_on: "2026-09-29",
        expected_harvest_on: "2026-10-20",
      },
    });

    expect(response.statusCode).toBe(404);
  });

  // TEST 7: Create a batch successfully
  it("creates a batch with SEEDED as the initial stage", async () => {
    const { response, batch } = await createTestBatch();

    expect(response.statusCode).toBe(201);
    expect(batch.crop).toBe("Lettuce");
    expect(batch.stage).toBe("SEEDED");
  });

  // TEST 8: Get batches with default pagination
  it("returns batches with pagination information", async () => {
    await createTestBatch();

    const response = await app.inject({
      method: "GET",
      url: "/batches",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.data.length).toBe(1);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(12);
    expect(body.pagination.total).toBe(1);
    expect(body.pagination.total_pages).toBe(1);
  });

  // TEST 9: Filter batches by stage
  it("filters batches by stage", async () => {
    await createTestBatch();

    const response = await app.inject({
      method: "GET",
      url: "/batches?stage=SEEDED",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.length).toBe(1);
    expect(response.json().data[0].stage).toBe("SEEDED");
  });

  // TEST 10: Return no batches for a non-matching stage
  it("returns no batches when the stage filter does not match", async () => {
    await createTestBatch();

    const response = await app.inject({
      method: "GET",
      url: "/batches?stage=GROWING",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.length).toBe(0);
  });

  // TEST 11: Allow only one stage forward at a time
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

  // TEST 12: Move batch from SEEDED to GERMINATION
  it("moves a batch from SEEDED to GERMINATION", async () => {
    const { batch } = await createTestBatch();

    const response = await app.inject({
      method: "PATCH",
      url: `/batches/${batch.id}/stage`,
      payload: {
        stage: "GERMINATION",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().stage).toBe("GERMINATION");
  });

  // TEST 13: Reject changing a nonexistent batch
  it("returns 404 when updating a nonexistent batch", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/batches/00000000-0000-0000-0000-000000000000/stage",
      payload: {
        stage: "GERMINATION",
      },
    });

    expect(response.statusCode).toBe(404);
  });

  // TEST 14: Do not allow direct transition to HARVESTED
  it("does not allow directly changing a batch to HARVESTED", async () => {
    const { batch } = await createTestBatch();

    const response = await app.inject({
      method: "PATCH",
      url: `/batches/${batch.id}/stage`,
      payload: {
        stage: "HARVESTED",
      },
    });

    expect(response.statusCode).toBe(409);
  });

  // TEST 15: Allow harvesting only when batch is HARVEST_READY
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

  // TEST 16: Require an Idempotency-Key for harvesting
  it("requires an Idempotency-Key when harvesting", async () => {
    const { batch } = await createTestBatch();

    const response = await app.inject({
      method: "POST",
      url: `/batches/${batch.id}/harvest`,
      payload: {
        harvested_on: "2026-10-20",
        weight_grams: 500,
        grade: "A",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  // TEST 17: Record harvest, mark batch HARVESTED, and free the tray
  it("records harvest, marks batch as HARVESTED, and frees the tray", async () => {
    const { batch } = await createTestBatch();

    for (const stage of [
      "GERMINATION",
      "GROWING",
      "HARVEST_READY",
    ]) {
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

    // The tray is now free because the previous batch is HARVESTED.
    const secondBatchResponse = await createTestBatch();

    expect(secondBatchResponse.response.statusCode).toBe(201);
  });

  // TEST 18: Same Idempotency-Key returns the original result
  it("returns the original result when the same idempotency key is retried", async () => {
    const { batch } = await createTestBatch();

    for (const stage of [
      "GERMINATION",
      "GROWING",
      "HARVEST_READY",
    ]) {
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

    // Both responses must be exactly the same.
    expect(secondResponse.json()).toEqual(firstResponse.json());

    // Only one harvest record should exist.
    const harvestCount = await pool.query(
      "SELECT COUNT(*) FROM harvests WHERE batch_id = $1",
      [batch.id]
    );

    expect(Number(harvestCount.rows[0].count)).toBe(1);
  });

  // TEST 19: Two concurrent requests cannot create two active batches
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


  // TEST 20: Allow one-step backward stage correction with authorization
  it("allows one-step backward stage correction with valid authorization", async () => {
    const { batch } = await createTestBatch();

    // Move SEEDED -> GERMINATION -> GROWING
    for (const stage of ["GERMINATION", "GROWING"]) {
      const response = await app.inject({
        method: "PATCH",
        url: `/batches/${batch.id}/stage`,
        payload: { stage },
      });

      expect(response.statusCode).toBe(200);
    }

    // Move GROWING -> GERMINATION
    const response = await app.inject({
      method: "PATCH",
      url: `/batches/${batch.id}/stage/correction`,
      payload: {
        stage: "GERMINATION",
        authorization_code: "123",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().stage).toBe("GERMINATION");
  });

  // TEST 21: Reject stage correction with invalid authorization
  it("rejects stage correction with invalid authorization", async () => {
    const { batch } = await createTestBatch();

    // Move SEEDED -> GERMINATION
    const forwardResponse = await app.inject({
      method: "PATCH",
      url: `/batches/${batch.id}/stage`,
      payload: {
        stage: "GERMINATION",
      },
    });

    expect(forwardResponse.statusCode).toBe(200);

    // Try to move back with the wrong authorization code
    const response = await app.inject({
      method: "PATCH",
      url: `/batches/${batch.id}/stage/correction`,
      payload: {
        stage: "SEEDED",
        authorization_code: "999",
      },
    });

    expect(response.statusCode).toBe(403);

    // Stage should remain unchanged
    const batchCheck = await pool.query(
      "SELECT stage FROM batches WHERE id = $1",
      [batch.id]
    );

    expect(batchCheck.rows[0].stage).toBe("GERMINATION");
  });

  // TEST 22: Reject backward correction by more than one stage
  it("rejects moving backward more than one stage", async () => {
    const { batch } = await createTestBatch();

    // Move SEEDED -> GERMINATION -> GROWING
    for (const stage of ["GERMINATION", "GROWING"]) {
      const response = await app.inject({
        method: "PATCH",
        url: `/batches/${batch.id}/stage`,
        payload: { stage },
      });

      expect(response.statusCode).toBe(200);
    }

    // Try to move GROWING -> SEEDED, skipping GERMINATION
    const response = await app.inject({
      method: "PATCH",
      url: `/batches/${batch.id}/stage/correction`,
      payload: {
        stage: "SEEDED",
        authorization_code: "123",
      },
    });

    expect(response.statusCode).toBe(409);

    // Stage should remain GROWING
    const batchCheck = await pool.query(
      "SELECT stage FROM batches WHERE id = $1",
      [batch.id]
    );

    expect(batchCheck.rows[0].stage).toBe("GROWING");
  });

  // TEST 23: Reject stage correction by more than one stage
  it("rejects moving backward more than one stage", async () => {
    const { batch } = await createTestBatch();

    // Move SEEDED -> GERMINATION -> GROWING
    for (const stage of ["GERMINATION", "GROWING"]) {
      const response = await app.inject({
        method: "PATCH",
        url: `/batches/${batch.id}/stage`,
        payload: { stage },
      });

      expect(response.statusCode).toBe(200);
    }

    // Try to move GROWING -> SEEDED, skipping GERMINATION
    const response = await app.inject({
      method: "PATCH",
      url: `/batches/${batch.id}/stage/correction`,
      payload: {
        stage: "SEEDED",
        authorization_code: "123",
      },
    });

    expect(response.statusCode).toBe(409);

    // Stage should remain GROWING
    const batchCheck = await pool.query(
      "SELECT stage FROM batches WHERE id = $1",
      [batch.id]
    );

    expect(batchCheck.rows[0].stage).toBe("GROWING");
  });
});