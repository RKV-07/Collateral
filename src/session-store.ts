import session from "express-session";
import { prisma } from "./db.js";

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function expiresAtOf(sess: session.SessionData): Date {
  const expires = sess?.cookie?.expires;
  return expires && !Number.isNaN(new Date(expires).getTime())
    ? new Date(expires)
    : new Date(Date.now() + DEFAULT_MAX_AGE_MS);
}

/**
 * express-session Store backed by the Prisma `Session` table in the same
 * SQLite database as users — server-side sessions survive restarts and are
 * never held in memory.
 */
export class PrismaSessionStore extends session.Store {
  async get(sid: string, cb: (err: unknown, session?: session.SessionData | null) => void): Promise<void> {
    try {
      const row = await prisma.session.findUnique({ where: { id: sid } });
      if (!row) {
        return cb(null, null);
      }
      if (new Date(row.expiresAt).getTime() < Date.now()) {
        await prisma.session.delete({ where: { id: sid } }).catch(() => {});
        return cb(null, null);
      }
      cb(null, {
        cookie: {
          originalMaxAge: new Date(row.expiresAt).getTime() - Date.now(),
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
        },
        passport: { user: row.userId },
      } as session.SessionData);
    } catch (err) {
      cb(err);
    }
  }

  async set(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): Promise<void> {
    try {
      const userId = (sess as { passport?: { user?: string } })?.passport?.user;
      const expiresAt = expiresAtOf(sess);

      // No user attached (e.g. passport cleared it during logout) — the
      // session should not persist.
      if (!userId) {
        await prisma.session.delete({ where: { id: sid } }).catch(() => {});
        return cb?.();
      }

      await prisma.session.upsert({
        where: { id: sid },
        create: { id: sid, userId, expiresAt },
        update: { userId, expiresAt },
      });
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  async destroy(sid: string, cb?: (err?: unknown) => void): Promise<void> {
    try {
      await prisma.session.delete({ where: { id: sid } }).catch(() => {});
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  async touch(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): Promise<void> {
    try {
      await prisma.session
        .update({ where: { id: sid }, data: { expiresAt: expiresAtOf(sess) } })
        .catch(() => {});
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }
}
