// This describes what a valid POST /trays request looks like.


// import { InvalidLiteralValue } from "@fastify/type-provider-typebox"
import { Type } from "@sinclair/typebox";

export const CreateTraySchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  zone: Type.String({ minLength: 1 }),
  capacity_units: Type.Integer({ minimum: 1 }),
});

// eg . json
// valid
// {
//   "code": "T-A-014",
//   "zone": "A",
//   "capacity_units": 100
// } 

// invalid
// {
//   "code": "",
//   "zone": "A",
//   "capacity_units": -5
// }