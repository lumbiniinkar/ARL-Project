'''
# AgResearch Labs — Tray and Batch API

Fastify + TypeScript + PostgreSQL REST API for managing aeroponic growing trays, crop batches, harvests, and yield reports.

This project implements Parts 1, 2, and all three Part 3 tasks (3a, 3b, 3c) from the assignment.

---

## 1. Tech Stack

- TypeScript
- Fastify
- PostgreSQL
- TypeBox for request validation
- Vitest for automated tests
- Node.js

---

## 2. Setup

### Requirements

- Node.js 20+
- PostgreSQL 14+
- npm

### Install dependencies

```bash
npm install
````

### Create the PostgreSQL databases

Create:

```
arl_assignment
arl_assignment_test
```

The application uses `arl_assignment` for normal development and `arl_assignment_test` for automated tests.

### Create the database schema

Run:

```bash
"D:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d arl_assignment -f sql\schema.sql
```

For the test database:

```bash
"D:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -d arl_assignment_test -f sql\schema.sql
```

> Update the PostgreSQL path if `psql.exe` is installed somewhere else.

### PostgreSQL configuration

The current local configuration is stored in:

```
src/db.ts
```

Update the PostgreSQL username, password, and database name if your local setup is different.

---

## 3. Run the Application

Start the development server:

```bash
npm run dev
```

The API runs on:

```
http://localhost:3000
```

Health check:

```
GET /health
```

Expected response:

```json
{
  "status": "ok"
}
```

---

## 4. Run Tests

Run the automated tests with:

```bash
npm test
```

The test suite covers the main batch business rules, idempotent harvests, and concurrent batch creation.

---

## 5. Build

To compile the TypeScript project:

```bash
npm run build
```

To run the compiled application:

```bash
npm start
```

---

# 6. API Endpoints

| Method | Endpoint               | Description                              |
| ------ | ---------------------- | ---------------------------------------- |
| POST   | `/trays`               | Create a tray                            |
| GET    | `/trays`               | List all trays                           |
| GET    | `/trays/:id`           | Get a tray by ID                         |
| POST   | `/batches`             | Create a new crop batch                  |
| GET    | `/batches`             | List batches with filters and pagination |
| PATCH  | `/batches/:id/stage`   | Move a batch one stage forward           |
| PATCH | `/batches/:id/stage/correction` | Move a batch one stage backward with authorization |
| POST   | `/batches/:id/harvest` | Harvest a batch                          |
| GET    | `/reports/yield`       | Generate a yield report                  |
| GET    | `/health`              | Health check                             |

---

# 7. Batch Lifecycle

A batch moves through these stages:

```
SEEDED
   ↓
GERMINATION
   ↓
GROWING
   ↓
HARVEST_READY
   ↓
HARVESTED
```

A batch can only move forward **one stage at a time**.

`HARVESTED` cannot be set directly through the stage endpoint. It is reached through the harvest endpoint, where the harvest information is recorded.

---

# 8. Business Rules

### Rule 1 — One active batch per tray

A tray can contain only one active batch.

A batch whose stage is `HARVESTED` is no longer considered active, so the tray becomes available for another batch.

This rule is checked in the API before insertion and is also enforced by PostgreSQL using a partial unique index:

```sql
CREATE UNIQUE INDEX one_active_batch_per_tray
ON batches (tray_id)
WHERE stage <> 'HARVESTED';
```

The database constraint is important because two concurrent requests could otherwise both pass the application's initial availability check.

---

### Rule 2 — Stage moves forward one step at a time

Valid transitions are:

```
SEEDED → GERMINATION
GERMINATION → GROWING
GROWING → HARVEST_READY
```

Skipping a stage or moving backwards returns:

```
Skipping a stage forward returns:

```text
409 Conflict
```

The valid stage values are also enforced by a PostgreSQL `CHECK` constraint.

---

### Rule 3 — Harvest only from HARVEST_READY

A batch cannot be harvested unless its current stage is:

```
HARVEST_READY
```

Otherwise the API returns:

```
409 Conflict
```

---

### Rule 4 — Harvest moves the batch to HARVESTED

When a harvest succeeds:

1. A row is inserted into `harvests`.
2. The batch stage changes to `HARVESTED`.
3. The tray becomes available for another batch.

These operations happen inside the same database transaction.

---

# 9. Where the Rules Are Enforced

The application uses both application-level checks and database constraints.

The API performs checks first so that clients receive clear error messages.

PostgreSQL provides the final protection for rules that must remain true even when multiple requests are processed concurrently.

### Concurrency example

For two requests attempting to create a batch on the same tray:

```
Request 1 ──┐
            ├── PostgreSQL unique index ──> one succeeds
Request 2 ──┘                              one gets 409
```

This means the protection does not depend on a single Node.js process.

If multiple API instances are running behind a load balancer, they still share the same PostgreSQL constraint.

---

# 10. Part 3a — Concurrency Safety

The concurrency requirement was implemented using PostgreSQL's partial unique index:

```sql
CREATE UNIQUE INDEX one_active_batch_per_tray
ON batches (tray_id)
WHERE stage <> 'HARVESTED';
```

The API also catches PostgreSQL error `23505` for this constraint and converts it into a clean:

```
409 Conflict
```

### Why this works

The application first checks whether the tray has an active batch.

However, this check alone is not enough because two requests could both read the tray before either request inserts the batch.

The PostgreSQL unique index protects the actual insert operation.

Therefore, when two requests arrive concurrently:

* one batch is inserted successfully;
* the other insert is rejected by PostgreSQL;
* the rejected request receives `409 Conflict`.

### Test

The test suite uses `Promise.all()` to send two batch creation requests concurrently for the same tray.

It verifies:

```
one response = 201
one response = 409
database contains exactly one batch
```

---

# 11. Part 3b — Idempotent Harvest

The harvest endpoint requires an:

```
Idempotency-Key
```

header.

Example:

```
Idempotency-Key: harvest-001
```

The key and original response are stored in the `idempotency_keys` table.

The harvest and idempotency record are written inside the same database transaction.

### Retry behaviour

If the same key is sent again within the validity period, the API returns the previously stored result instead of creating another harvest.

This prevents duplicate harvest records when a client retries a request because of a network timeout or lost response.

Example:

```
First request
    ↓
Create harvest
    ↓
Store response with idempotency key
    ↓
Return 201

Retry with same key
    ↓
Find stored response
    ↓
Return original response
    ↓
No second harvest
```

### Validity

The chosen idempotency-key validity period is:

```
24 hours
```

The assumption is that a normal retry should occur within this period.

The current implementation stores the original response so that the retry receives the same result.

---

# 12. Part 3c — Yield Report

Endpoint:

```
GET /reports/yield
```

Required query parameter:

```
group_by=crop
```

or:

```
group_by=zone
```

Optional date filters:

```
from=YYYY-MM-DD
to=YYYY-MM-DD
```

Example:

```
GET /reports/yield?group_by=crop&from=2026-09-01&to=2026-09-30
```

The report returns:

* total harvested weight
* number of harvested batches
* average number of days from seeding to harvest

---

## Yield Report SQL

The report is generated using a single SQL query:

```sql
SELECT
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
WHERE b.stage = 'HARVESTED'
GROUP BY ${groupColumn}
ORDER BY ${groupColumn};
```

The application chooses `${groupColumn}` from two fixed values:

```
crop → b.crop
zone  → t.zone
```

The user cannot provide arbitrary SQL as the grouping value.

Date filters are added using parameterized query values.

### How the query works

1. `batches` identifies the crop batch.
2. `harvests` provides the harvested weight and harvest date.
3. `trays` provides the zone.
4. Only harvested batches are included.
5. `SUM()` calculates total harvested weight.
6. `COUNT()` calculates the number of harvested batches.
7. `AVG()` calculates the average days between `seeded_on` and `harvested_on`.
8. `GROUP BY` produces one result for each crop or zone.

There is no application-level loop over individual groups; the aggregation is performed by PostgreSQL.

---

# 13. Filtering and Pagination

`GET /batches` supports:

```
stage
crop
zone
page
limit
```

Example:

```
GET /batches?stage=GROWING&zone=A&page=1&limit=12
```

Filters are combined using `AND`.

Pagination defaults to:

```
page = 1
limit = 12
```

The maximum allowed limit is:

```
100
```

The response includes:

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 12,
    "total": 0,
    "total_pages": 0
  }
}
```

---

# 14. HTTP Status Codes

| Status | Meaning                                  |
| ------ | ---------------------------------------- |
| 200    | Successful request                       |
| 201    | Resource successfully created            |
| 400    | Invalid request or validation error      |
| 404    | Resource not found                       |
| 409    | Request conflicts with the current state |

Examples of `409 Conflict`:

* tray already has an active batch
* invalid stage transition
* attempting to harvest before `HARVEST_READY`
* duplicate tray code

---

# 15. Database Design

The main tables are:

```
trays
   │
   └── batches
          │
          └── harvests

idempotency_keys
```

### `trays`

Stores physical tray information:

* `id`
* `code`
* `zone`
* `capacity_units`
* `created_at`

### `batches`

Stores crop batches:

* `id`
* `tray_id`
* `crop`
* `seeded_on`
* `stage`
* `expected_harvest_on`

### `harvests`

Stores completed harvest information:

* `id`
* `batch_id`
* `harvested_on`
* `weight_grams`
* `grade`

### `idempotency_keys`

Stores the original harvest response associated with an idempotency key.

---

# 16. Project Structure

```
arl-software-assignment/
│
├── src/
│   ├── server.ts
│   ├── db.ts
│   ├── types.ts
│   │
│   ├── schemas/
│   │   ├── tray.ts
│   │   ├── batch.ts
│   │   ├── stage.ts
│   │   ├── harvest.ts
│   │   └── batchQuery.ts
│   │
│   └── routes/
│       ├── trays.ts
│       ├── batches.ts
│       └── reports.ts
│
├── tests/
│   └── batches.test.ts
│
├── sql/
│   └── schema.sql
│
├── package.json
├── tsconfig.json
└── README.md
```

The project intentionally does not add separate controller/service/repository layers because the assignment is small and time-boxed. The route files contain the API and business logic, while PostgreSQL handles persistence and database-level constraints.

---

# 17. Assumptions

* Tray codes are unique.
* `zone` is stored as free  because the assignment does not define a fixed set of zones.
* `capacity_units` must be greater than zero.
* Every new batch starts at `SEEDED`.
* The client provides `seeded_on`.
* The client provides `expected_harvest_on`.
* Harvest dates are supplied by the client.
* `weight_grams` must be greater than zero.
* Grade must be `A`, `B`, or `C`.
* Dates are represented as `YYYY-MM-DD`.
* A tray is considered available when it has no batch whose stage is different from `HARVESTED`.
* `HARVESTED` can only be reached through the harvest endpoint.
* Authentication and authorization are outside the scope of the assignment.
* No delete endpoints are required by the specification.

---

# 18. What Is Not Implemented / Future Improvements

The required functionality for Parts 1, 2, 3a, 3b, and 3c has been implemented.

Possible future improvements include:

* Move PostgreSQL credentials from `src/db.ts` into environment variables.
* Add a migration tool instead of relying on a single `schema.sql`.
* Add more comprehensive validation for date formats and date relationships.
* Add more automated tests for filtering and yield-report edge cases.
* Add indexes based on real query patterns.
* Add cleanup for expired idempotency keys.
* Move business logic into service modules if the application grows.
* Run the concurrency test against multiple API processes to simulate a multi-instance deployment.

---

# 19. AI Usage

I used AI tools during development for:

* understanding and breaking down the assignment requirements;
* discussing API and database design;
* debugging Fastify, TypeScript, and PostgreSQL issues;
* reviewing SQL and database constraints;
* helping write and review automated tests;
* discussing concurrency and idempotency implementation;
* drafting and reviewing the README.

I reviewed, ran, tested, and modified the generated suggestions myself and can explain the implementation and design decisions in the project.

````
