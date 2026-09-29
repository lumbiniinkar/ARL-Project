import type { Tray } from "./types.js";
import type { Batch } from "./types.js";

// Simple in-memory storage for Part 1.
// Part 2 will replace this with PostgreSQL.
export const trays: Tray[] = [];
export const batches: Batch[] = [];