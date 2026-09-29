import { Type } from "@sinclair/typebox";

// Validates the request body when creating a new batch.
export const CreateBatchSchema = Type.Object({
  tray_id: Type.String({ minLength: 1 }),
  crop: Type.String({ minLength: 1 }),
  seeded_on: Type.String({ minLength: 1 }),
  expected_harvest_on: Type.String({ minLength: 1 }),
});