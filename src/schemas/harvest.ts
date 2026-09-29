import { Type } from "@sinclair/typebox";

// Validates the data recorded when a batch is harvested.
export const HarvestSchema = Type.Object({
  harvested_on: Type.String({ minLength: 1 }),
  weight_grams: Type.Number({ exclusiveMinimum: 0 }),
  grade: Type.Union([
    Type.Literal("A"),
    Type.Literal("B"),
    Type.Literal("C"),
  ]),
});