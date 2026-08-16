import { Firestore } from "@google-cloud/firestore";
import { prisma } from "./db.js";

export interface AuditRecord {
  timestamp: string;
  userId?: string;
  account_id?: string;
  risk_state: string;
  current_ltv: number;
  headroom: number;
  recommended_action: string;
  proposed_lots_count: number;
  approved: boolean;
  status: string;
  provider: string;
}

export interface AuditStore {
  save(record: AuditRecord): Promise<void>;
  listRecent(userId?: string, limit?: number): Promise<AuditRecord[]>;
}

/**
 * Prisma-backed audit store — the default for the web app. Audit entries live
 * in the same SQLite database as users/portfolios (`data/collateral.db`) and
 * are scoped to the user who triggered them.
 */
export class PrismaAuditStore implements AuditStore {
  async save(record: AuditRecord): Promise<void> {
    await prisma.auditTrail.create({
      data: {
        userId: record.userId ?? null,
        timestamp: record.timestamp,
        accountId: record.account_id ?? null,
        riskState: record.risk_state,
        currentLtv: record.current_ltv,
        headroom: record.headroom,
        recommendedAction: record.recommended_action,
        proposedLotsCount: record.proposed_lots_count,
        approved: record.approved,
        status: record.status,
        provider: record.provider,
      },
    });
  }

  async listRecent(userId?: string, limit: number = 50): Promise<AuditRecord[]> {
    const rows = await prisma.auditTrail.findMany({
      where: userId ? { userId } : {},
      orderBy: { id: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      timestamp: r.timestamp,
      userId: r.userId ?? undefined,
      account_id: r.accountId ?? undefined,
      risk_state: r.riskState,
      current_ltv: r.currentLtv,
      headroom: r.headroom,
      recommended_action: r.recommendedAction,
      proposed_lots_count: r.proposedLotsCount,
      approved: r.approved,
      status: r.status,
      provider: r.provider,
    }));
  }
}

/**
 * Firestore audit store (optional production / Cloud Run).
 * Selected with `AUDIT_STORAGE=firestore`. Uses Application Default
 * Credentials — never required for the default self-hosted path.
 */
export class FirestoreAuditStore implements AuditStore {
  private db: Firestore;

  constructor(projectId?: string, private collection: string = "audit_trail") {
    this.db = new Firestore(projectId ? { projectId } : undefined);
  }

  async save(record: AuditRecord): Promise<void> {
    await this.db.collection(this.collection).add(record);
  }

  async listRecent(userId?: string, limit: number = 50): Promise<AuditRecord[]> {
    let query: FirebaseFirestore.Query = this.db
      .collection(this.collection)
      .orderBy("timestamp", "desc");
    if (userId) {
      query = query.where("userId", "==", userId);
    }
    const snap = await query.limit(limit).get();
    return snap.docs.map((d) => d.data() as AuditRecord);
  }
}

/**
 * In-memory store — last-resort fallback so the app never crashes if
 * the Prisma store fails to initialize.
 */
export class MemoryAuditStore implements AuditStore {
  private records: AuditRecord[] = [];

  async save(record: AuditRecord): Promise<void> {
    this.records.unshift(record);
    if (this.records.length > 5000) this.records.length = 5000;
  }

  async listRecent(userId?: string, limit: number = 50): Promise<AuditRecord[]> {
    return (userId ? this.records.filter((r) => r.userId === userId) : this.records).slice(0, limit);
  }
}

/**
 * Selects the audit backend at boot:
 *   AUDIT_STORAGE=firestore → Firestore (optional; Cloud Run / production)
 *   anything else           → Prisma + SQLite (default, self-hosted)
 */
export function createAuditStore(): AuditStore {
  const mode = (process.env.AUDIT_STORAGE || "sqlite").toLowerCase();
  if (mode === "firestore") {
    try {
      return new FirestoreAuditStore();
    } catch (err) {
      console.error("[audit] Firestore init failed — falling back to SQLite:", err);
    }
  }
  try {
    return new PrismaAuditStore();
  } catch (err) {
    console.error("[audit] Prisma/SQLite init failed — falling back to memory:", err);
    return new MemoryAuditStore();
  }
}
