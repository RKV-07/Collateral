import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

// Single Prisma-backed SQLite store for the whole web app path: users,
// sessions, portfolios/holdings/lots, and the audit trail all live in one
// file (`<cwd>/data/collateral.db`) — mounted as a volume in Docker.
//
// DATABASE_URL is resolved to an absolute path so the client is unambiguous
// regardless of the process working directory. The Prisma CLI (migrations)
// instead resolves its own value relative to the schema directory.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${join(process.cwd(), "data", "collateral.db")}`;
}

export const prisma = new PrismaClient();
