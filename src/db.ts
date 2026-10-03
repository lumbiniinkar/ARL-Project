// connecting our TypeScript/Node.js application to PostgreSQL.
import pg from "pg";
// pg is Node.js postgre sql library, pg provides the pool(DB connections for using) class

const { Pool } = pg;

export const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "sql",
  database: "arl_assignment",
});