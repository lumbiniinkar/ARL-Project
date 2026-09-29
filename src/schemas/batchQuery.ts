import { Type } from "@sinclair/typebox";

// Validates filters and pagination for GET /batches.
export const BatchQuerySchema = Type.Object({
  stage: Type.Optional(
    Type.Union([
      Type.Literal("SEEDED"),
      Type.Literal("GERMINATION"),
      Type.Literal("GROWING"),
      Type.Literal("HARVEST_READY"),
      Type.Literal("HARVESTED"),
    ])
  ),
  crop: Type.Optional(Type.String({ minLength: 1 })),
  zone: Type.Optional(Type.String({ minLength: 1 })),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});