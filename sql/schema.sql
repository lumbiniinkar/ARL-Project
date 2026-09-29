-- Database schema for the ARL leafy-greens tracking API.

-- Stores the physical growing trays.
CREATE TABLE trays (
    id UUID PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    zone VARCHAR(50) NOT NULL,
    capacity_units INTEGER NOT NULL CHECK (capacity_units > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Stores crop batches assigned to trays.
CREATE TABLE batches (
    id UUID PRIMARY KEY,
    tray_id UUID NOT NULL REFERENCES trays(id),
    crop VARCHAR(100) NOT NULL,
    seeded_on DATE NOT NULL,
    stage VARCHAR(30) NOT NULL,
    expected_harvest_on DATE NOT NULL,

    CONSTRAINT batches_stage_check
        CHECK (
            stage IN (
                'SEEDED',
                'GERMINATION',
                'GROWING',
                'HARVEST_READY',
                'HARVESTED'
            )
        )
);

-- A tray can have only one batch that has not yet been harvested.
CREATE UNIQUE INDEX one_active_batch_per_tray
ON batches (tray_id)
WHERE stage <> 'HARVESTED';

-- Stores the result of harvesting a batch.
CREATE TABLE harvests (
    id UUID PRIMARY KEY,
    batch_id UUID NOT NULL UNIQUE REFERENCES batches(id),
    harvested_on DATE NOT NULL,
    weight_grams NUMERIC(10, 2) NOT NULL CHECK (weight_grams > 0),
    grade VARCHAR(1) NOT NULL CHECK (grade IN ('A', 'B', 'C'))
);


-- Stores idempotency keys for safe harvest retries.
CREATE TABLE idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES batches(id),
    response_status INTEGER NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);