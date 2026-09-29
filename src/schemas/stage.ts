import { Type } from "@sinclair/typebox";

// Valid stages for a batch.
export const StageSchema = Type.Object({
  stage: Type.Union([
    Type.Literal("SEEDED"),
    Type.Literal("GERMINATION"),
    Type.Literal("GROWING"),
    Type.Literal("HARVEST_READY"),
    Type.Literal("HARVESTED"),
  ]),
});