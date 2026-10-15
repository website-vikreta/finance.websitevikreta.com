import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as path from "path";
import * as dotenv from "dotenv";
import * as schema from "./schema";

// Anchor .env.local to the repo root so tsx scripts load it too
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

// Singleton pool instance for development and server actions
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export const db = drizzle(pool, { schema });
export { schema, pool };
