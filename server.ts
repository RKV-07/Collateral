import express, { NextFunction, Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import session from "express-session";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { GoogleGenAI } from "@google/genai";
import passport, { isGoogleConfigured } from "./src/auth.js";
import { prisma } from "./src/db.js";
import { PrismaSessionStore } from "./src/session-store.js";
import { calculateOptimizer, getAdjustedSnapshot } from "./src/utils.js";
import { AccountSnapshot, MarketEvent } from "./src/types.js";
import { createAuditStore, AuditStore, AuditRecord } from "./src/audit-store.js";
import {
  getRegistry,
  getPublicRegistry,
  getProvider,
  resolveApiKey,
  addProvider,
  addModel,
  updateProvider,
  updateModel,
  deleteProvider,
  deleteModel,
  setDefault,
  testProvider,
  ProviderConfig,
} from "./src/providers.js";

// Load environment variables
dotenv.config({ path: ".env.local" });

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

// In production the session secret must come from the environment — never the
// insecure dev fallback. Fail fast rather than ship guessable cookies.
const sessionSecret = process.env.SESSION_SECRET || "dev-insecure-secret-change-me";
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.error("FATAL: SESSION_SECRET is required in production.");
  process.exit(1);
}

app.set("trust proxy", 1);
app.use(express.json());
// Security headers (HSTS, X-Frame-Options, X-Content-Type-Options, etc.).
// CSP is left off so the Vite dev server / inline HMR payloads keep working.
app.use(helmet({ contentSecurityPolicy: false }));

// Server-side sessions stored in the Prisma `Session` table (same SQLite DB
// as users) — survives restarts, never held in memory.
app.use(
  session({
    name: "collateral.sid",
    secret: sessionSecret,
    store: new PrismaSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Brute-force protection: strict limiter on the credential login, plus a
// broad API limiter so a hostile client can't hammer the whole server.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});
app.use("/api/auth/login", loginLimiter);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests." },
});
app.use("/api/", apiLimiter);

// Authentication middleware for any route touching a user's portfolio,
// holdings, or audit log.
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  if ((req.user as { role?: string }).role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function currentUser(req: Request) {
  return req.user as Express.User;
}

// Audit trail backend — SQLite (dev/tests) or Firestore (AUDIT_STORAGE=firestore)
const auditStore = createAuditStore();

// Lightweight in-memory usage counter (reset on boot) — evidence-pack stats
const usage = { analyze: 0, chat: 0, audit: 0, prices: 0, since: new Date().toISOString() };

function toAuditRecord(
  userId: string,
  snapshot: AccountSnapshot,
  deterministic: { risk_state: string; current_ltv: number; headroom_dollars: number; recommended_action: string; proposed_lots_to_sell: unknown[]; },
  provider: string,
  status: string,
): AuditRecord {
  return {
    timestamp: new Date().toISOString(),
    userId,
    risk_state: deterministic.risk_state,
    current_ltv: deterministic.current_ltv,
    headroom: deterministic.headroom_dollars,
    recommended_action: deterministic.recommended_action,
    proposed_lots_count: Array.isArray(deterministic.proposed_lots_to_sell) ? deterministic.proposed_lots_to_sell.length : 0,
    approved: true,
    status,
    provider,
  };
}

// ---------------------------------------------------------------------------
// AI Provider dispatch
// ---------------------------------------------------------------------------

// OpenAI-compatible chat completions against any provider (Groq, Poolside,
// OpenRouter, or a user-added provider).
async function generateViaOpenAICompatible(
  provider: ProviderConfig,
  modelId: string,
  messages: { role: string; content: string }[]
): Promise<string> {
  const apiKey = resolveApiKey(provider);
  if (!apiKey) throw new Error(`No API key available for ${provider.name}`);

  const body: Record<string, unknown> = { model: modelId, messages, max_tokens: 2048 };
  if (provider.id === "poolside") {
    body.thinking = { type: "disabled" };
  }

  const res = await fetch(`${provider.baseUrl!.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider.name} ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// Gemini via the official @google/genai SDK (already installed).
async function generateViaGemini(
  provider: ProviderConfig,
  modelId: string,
  messages: { role: string; content: string }[],
  systemInstruction?: string
): Promise<string> {
  const apiKey = resolveApiKey(provider);
  if (!apiKey) throw new Error("No GEMINI_API_KEY / GOOGLE_API_KEY available");

  const ai = new GoogleGenAI({ apiKey });

  const systemText = systemInstruction || messages.find((m) => m.role === "system")?.content;
  const contents = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const response = await ai.models.generateContent({
    model: modelId,
    contents,
    config: {
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      maxOutputTokens: 2048,
      temperature: 0.1,
    },
  });
  return response.text || "";
}

// Generic per-provider generation dispatcher.
async function generateViaProvider(
  provider: ProviderConfig,
  modelId: string,
  messages: { role: string; content: string }[],
  systemInstruction?: string
): Promise<string> {
  if (provider.kind === "gemini") {
    return generateViaGemini(provider, modelId, messages, systemInstruction);
  }
  return generateViaOpenAICompatible(provider, modelId, messages);
}

// Build an ordered provider chain for a request. The user-selected provider is
// tried first, then the built-in fallbacks (Gemini primary), then any custom
// providers. Providers without an API key are skipped at call time.
function buildProviderChain(selectedProviderId?: string, selectedModel?: string) {
  const reg = getRegistry();
  const fallbackOrder = ["gemini", "groq", "poolside", "openrouter"];
  const builtins = fallbackOrder
    .map((id) => reg.providers.find((p) => p.id === id))
    .filter((p): p is ProviderConfig => !!p);
  const custom = reg.providers.filter((p) => !fallbackOrder.includes(p.id));

  let ordered = [...builtins, ...custom];
  const selected = reg.providers.find((p) => p.id === selectedProviderId);
  if (selected) {
    ordered = [selected, ...ordered.filter((p) => p.id !== selected.id)];
  }

  const fallbackModel = reg.defaultModel;
  return ordered
    .map((provider) => ({
      provider,
      modelId: selectedProviderId === provider.id && selectedModel && provider.models.some((m) => m.id === selectedModel)
        ? selectedModel
        : provider.models.some((m) => m.id === fallbackModel)
        ? fallbackModel
        : provider.models[0]?.id,
    }))
    .filter((x) => x.modelId);
}

// Try providers in order until one returns text.
async function generateWithChain(
  chain: { provider: ProviderConfig; modelId: string }[],
  messages: { role: string; content: string }[],
  systemInstruction?: string
): Promise<{ text: string; provider: string; model: string } | null> {
  for (const { provider, modelId } of chain) {
    if (!resolveApiKey(provider)) continue;
    try {
      const text = await generateViaProvider(provider, modelId, messages, systemInstruction);
      if (text) {
        return { text, provider: provider.id, model: modelId };
      }
    } catch (e: any) {
      console.error(`[generate] ${provider.name}/${modelId} failed:`, e.message?.slice(0, 200));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Model / Provider management API
// ---------------------------------------------------------------------------

// Registry overview (API keys never leave the server)
app.get("/api/models", (_req, res) => {
  res.json(getPublicRegistry());
});

// Add a custom provider (OpenAI-compatible or Gemini)
app.post("/api/models/providers", (req, res) => {
  try {
    const { id, name, kind, baseUrl, apiKey, models } = req.body || {};
    res.json(addProvider({ id, name, kind, baseUrl, apiKey, models }));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Could not add provider." });
  }
});

// Add a model to an existing provider
app.post("/api/models/providers/:providerId/models", (req, res) => {
  try {
    const { id, name, badge, desc } = req.body || {};
    res.json(addModel(req.params.providerId, { id, name, badge, desc }));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Could not add model." });
  }
});

// Edit an existing custom provider (name / kind / baseUrl / apiKey)
app.patch("/api/models/providers/:providerId", (req, res) => {
  try {
    const { name, kind, baseUrl, apiKey } = req.body || {};
    res.json(updateProvider(req.params.providerId, { name, kind, baseUrl, apiKey }));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Could not update provider." });
  }
});

// Edit an existing user-added model (name / badge / desc)
app.patch("/api/models/providers/:providerId/models/:modelId", (req, res) => {
  try {
    const { name, badge, desc } = req.body || {};
    res.json(updateModel(req.params.providerId, req.params.modelId, { name, badge, desc }));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Could not update model." });
  }
});

// Delete a custom provider
app.delete("/api/models/providers/:providerId", (req, res) => {
  try {
    res.json(deleteProvider(req.params.providerId));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Could not delete provider." });
  }
});

// Delete a user-added model
app.delete("/api/models/providers/:providerId/models/:modelId", (req, res) => {
  try {
    res.json(deleteModel(req.params.providerId, req.params.modelId));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Could not delete model." });
  }
});

// Set the default provider / model
app.post("/api/models/default", (req, res) => {
  try {
    const { providerId, modelId } = req.body || {};
    if (!providerId) return res.status(400).json({ error: "providerId is required." });
    res.json(setDefault(providerId, modelId));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Could not set default." });
  }
});

// Live connection test
app.post("/api/models/test", async (req, res) => {
  try {
    const { providerId, modelId } = req.body || {};
    if (!providerId || !modelId) return res.status(400).json({ error: "providerId and modelId are required." });
    res.json(await testProvider(providerId, modelId));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Test failed." });
  }
});

// Check if providers are configured
app.get("/api/health", (_req, res) => {
  const reg = getPublicRegistry();
  res.json({
    status: "ok",
    hasGroqKey: !!process.env.GROQ_API_KEY,
    hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    hasPoolsideKey: !!process.env.POOLSIDE_API_KEY,
    hasGeminiKey: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    auditStorage: (process.env.AUDIT_STORAGE || "sqlite").toLowerCase(),
    defaultProvider: reg.defaultProvider,
    defaultModel: reg.defaultModel,
    hasGoogleOAuth: isGoogleConfigured(),
    usage,
  });
});

// ---------------------------------------------------------------------------
// Auth (Google OAuth via passport)
// ---------------------------------------------------------------------------

// Kick off the Google consent screen
app.get("/auth/google", (req, res, next) => {
  if (!isGoogleConfigured()) {
    return res.redirect("/?error=oauth_not_configured");
  }
  passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

// OAuth callback — creates/finds the User row, persists the session, redirects
app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (_req, res) => {
    res.redirect("/dashboard");
  }
);

// Destroy the session and return to the landing page
const logoutHandler = (req: Request, res: Response, next: NextFunction) => {
  req.logOut((err) => {
    if (err) return next(err);
    req.session.destroy((destroyErr) => {
      if (destroyErr) return next(destroyErr);
      res.clearCookie("collateral.sid");
      res.redirect("/");
    });
  });
};
app.post("/logout", logoutHandler);
app.get("/logout", logoutHandler);

// Current user (for the client to render nav state)
app.get("/api/me", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  const u = req.user;
  res.json({ user: { id: u.id, googleId: u.googleId, email: u.email, name: u.name ?? null, role: (u as { role?: string }).role ?? "USER" } });
});

// Dev-only login helper — lets you exercise the full authenticated flow
// (session cookie → dashboard → stocks) without real OAuth credentials.
// Never compiled into a production deployment: only reachable when
// NODE_ENV !== "production".
app.post("/dev/login", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" });
  }
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Provide a valid email" });
    }
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, googleId: `dev:${email}`, name: email.split("@")[0] },
      update: { name: email.split("@")[0] },
    });
    await new Promise<void>((resolve, reject) =>
      req.login(user, (err) => (err ? reject(err) : resolve()))
    );
    res.json({
      dev: true,
      user: { id: user.id, googleId: user.googleId, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error("Dev login failed:", err);
    res.status(500).json({ error: "Dev login failed" });
  }
});

// ---------------------------------------------------------------------------
// Credential login (ADMIN_EMAIL / ADMIN_PASSWORD_HASH from .env) — coexists
// with Google OAuth. The only account that can use it is the admin account;
// regular users keep signing in with Google.
// ---------------------------------------------------------------------------

app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const adminHash = process.env.ADMIN_PASSWORD_HASH || "";
    if (!adminEmail || !adminHash) {
      return res.status(501).json({ error: "Admin credentials not configured on the server." });
    }

    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    // Constant-time-ish: always run a bcrypt compare so a missing/invalid
    // email doesn't leak timing information.
    const hashMatches = await bcrypt.compare(password, adminHash);
    const emailMatches = email === adminEmail;
    if (!hashMatches || !emailMatches) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail, googleId: `admin:${adminEmail}`, name: "Admin", role: "ADMIN" },
      update: { role: "ADMIN" },
    });

    await new Promise<void>((resolve, reject) =>
      req.login(user, (err) => (err ? reject(err) : resolve()))
    );
    res.json({ user: { id: user.id, googleId: user.googleId, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error("Admin login failed:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ---------------------------------------------------------------------------
// Portfolio API (all scoped to the authenticated user)
// ---------------------------------------------------------------------------

function serializeLot(lot: { id: string; quantity: number; costBasis: number; acquiredAt: Date }) {
  return {
    id: lot.id,
    quantity: lot.quantity,
    costBasis: lot.costBasis,
    acquiredAt: lot.acquiredAt.toISOString(),
    acquiredDate: lot.acquiredAt.toISOString().slice(0, 10),
  };
}

function serializePortfolio(p: {
  id: string;
  cash: number;
  loanBalance: number;
  maintenanceLtvLimit: number;
  updatedAt: Date;
  holdings: { id: string; symbol: string; lots: { id: string; quantity: number; costBasis: number; acquiredAt: Date }[] }[];
}) {
  return {
    id: p.id,
    cash: p.cash,
    loanBalance: p.loanBalance,
    maintenanceLtvLimit: p.maintenanceLtvLimit,
    updatedAt: p.updatedAt.toISOString(),
    holdings: p.holdings.map((h) => ({
      id: h.id,
      symbol: h.symbol,
      lots: h.lots.map(serializeLot),
    })),
  };
}

async function getOrCreatePortfolio(userId: string) {
  let portfolio = await prisma.portfolio.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { holdings: { include: { lots: true } } },
  });
  if (!portfolio) {
    portfolio = await prisma.portfolio.create({
      data: { userId },
      include: { holdings: { include: { lots: true } } },
    });
  }
  return portfolio;
}

const SYMBOL_REGEX = /^[A-Z0-9.\-]{1,10}$/;

// Fetch the logged-in user's portfolio (creates an empty one on first login)
app.get("/api/portfolio", requireAuth, async (req, res) => {
  try {
    const portfolio = await getOrCreatePortfolio(currentUser(req).id);
    res.json({ portfolio: serializePortfolio(portfolio) });
  } catch (err: any) {
    console.error("Portfolio fetch error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Update account-level properties (cash, loan balance, maintenance LTV limit)
app.patch("/api/portfolio", requireAuth, async (req, res) => {
  try {
    const { cash, loanBalance, maintenanceLtvLimit } = req.body || {};
    const portfolio = await getOrCreatePortfolio(currentUser(req).id);
    const data: { cash?: number; loanBalance?: number; maintenanceLtvLimit?: number } = {};
    if (typeof cash === "number" && isFinite(cash) && cash >= 0) data.cash = cash;
    if (typeof loanBalance === "number" && isFinite(loanBalance) && loanBalance >= 0) data.loanBalance = loanBalance;
    if (
      typeof maintenanceLtvLimit === "number" &&
      isFinite(maintenanceLtvLimit) &&
      maintenanceLtvLimit > 0 &&
      maintenanceLtvLimit <= 1
    ) {
      data.maintenanceLtvLimit = maintenanceLtvLimit;
    }
    const updated = await prisma.portfolio.update({
      where: { id: portfolio.id },
      data,
      include: { holdings: { include: { lots: true } } },
    });
    res.json({ portfolio: serializePortfolio(updated) });
  } catch (err: any) {
    console.error("Portfolio update error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Add a holding (symbol + one tax lot)
app.post("/api/portfolio/holdings", requireAuth, async (req, res) => {
  try {
    const { symbol, quantity, costBasis, acquiredAt } = req.body || {};
    const sym = String(symbol ?? "").toUpperCase();
    if (!SYMBOL_REGEX.test(sym)) {
      return res.status(400).json({ error: "Invalid symbol." });
    }
    const qty = Number(quantity);
    const cb = Number(costBasis);
    if (!isFinite(qty) || qty <= 0) return res.status(400).json({ error: "Quantity must be a positive number." });
    if (!isFinite(cb) || cb < 0) return res.status(400).json({ error: "Cost basis must be a non-negative number." });
    const date = acquiredAt ? new Date(acquiredAt) : new Date();
    if (Number.isNaN(date.getTime())) return res.status(400).json({ error: "Invalid acquired date." });

    const portfolio = await getOrCreatePortfolio(currentUser(req).id);
    const holding = await prisma.holding.create({
      data: {
        portfolioId: portfolio.id,
        symbol: sym,
        lots: { create: { quantity: qty, costBasis: cb, acquiredAt: date } },
      },
      include: { lots: true },
    });
    res.status(201).json({ holding: { id: holding.id, symbol: holding.symbol, lots: holding.lots.map(serializeLot) } });
  } catch (err: any) {
    console.error("Add holding error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Edit a holding (symbol and/or its lot fields)
app.patch("/api/portfolio/holdings/:holdingId", requireAuth, async (req, res) => {
  try {
    const holding = await prisma.holding.findFirst({
      where: { id: req.params.holdingId, portfolio: { userId: currentUser(req).id } },
      include: { lots: true },
    });
    if (!holding) return res.status(404).json({ error: "Holding not found." });

    const { symbol, quantity, costBasis, acquiredAt, lotId } = req.body || {};
    if (symbol !== undefined) {
      const sym = String(symbol ?? "").toUpperCase();
      if (!SYMBOL_REGEX.test(sym)) return res.status(400).json({ error: "Invalid symbol." });
      await prisma.holding.update({ where: { id: holding.id }, data: { symbol: sym } });
    }

    const lot = (lotId ? holding.lots.find((l) => l.id === lotId) : undefined) ?? holding.lots[0];
    if (lot && (quantity !== undefined || costBasis !== undefined || acquiredAt !== undefined)) {
      const lotData: { quantity?: number; costBasis?: number; acquiredAt?: Date } = {};
      if (quantity !== undefined) {
        const qty = Number(quantity);
        if (!isFinite(qty) || qty <= 0) return res.status(400).json({ error: "Quantity must be a positive number." });
        lotData.quantity = qty;
      }
      if (costBasis !== undefined) {
        const cb = Number(costBasis);
        if (!isFinite(cb) || cb < 0) return res.status(400).json({ error: "Cost basis must be a non-negative number." });
        lotData.costBasis = cb;
      }
      if (acquiredAt !== undefined) {
        const date = new Date(acquiredAt);
        if (Number.isNaN(date.getTime())) return res.status(400).json({ error: "Invalid acquired date." });
        lotData.acquiredAt = date;
      }
      await prisma.lot.update({ where: { id: lot.id }, data: lotData });
    }

    const updated = await prisma.holding.findUnique({ where: { id: holding.id }, include: { lots: true } });
    res.json({ holding: { id: updated!.id, symbol: updated!.symbol, lots: updated!.lots.map(serializeLot) } });
  } catch (err: any) {
    console.error("Edit holding error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Remove a holding (cascades to its lots)
app.delete("/api/portfolio/holdings/:holdingId", requireAuth, async (req, res) => {
  try {
    const holding = await prisma.holding.findFirst({
      where: { id: req.params.holdingId, portfolio: { userId: currentUser(req).id } },
    });
    if (!holding) return res.status(404).json({ error: "Holding not found." });
    await prisma.holding.delete({ where: { id: holding.id } });
    res.json({ ok: true });
  } catch (err: any) {
    console.error("Remove holding error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// API: Fetch live market prices via yfinance (Python subprocess).
// Scoped to the authenticated user's own held symbols, with a 60s in-memory
// TTL cache per symbol so page refreshes don't hammer yfinance.
interface CachedPrice { price: number; source: string; dayChange?: number; dayChangePct?: number; expiresAt: number }
const priceCache = new Map<string, CachedPrice>();
const PRICE_CACHE_TTL_MS = 60_000;

app.post("/api/portfolio/prices", requireAuth, async (req, res) => {
  try {
    const { symbols } = req.body as { symbols?: string[] };
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: "Missing or empty symbols array." });
    }

    const userId = currentUser(req).id;

    // Only fetch prices for symbols the user actually holds.
    const portfolio = await getOrCreatePortfolio(userId);
    const owned = new Set(portfolio.holdings.map((h) => h.symbol.toUpperCase()));
    const uniqueSymbols = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter((s) => owned.has(s)))];

    // Defense-in-depth: validate symbol format
    const symbolRegex = /^[A-Z0-9.\-]{1,10}$/;
    const validSymbols = uniqueSymbols.filter((s) => symbolRegex.test(s));
    if (validSymbols.length === 0) {
      return res.json({ prices: {}, count: 0 });
    }

    const now = Date.now();
    const prices: Record<string, { price: number; source: string; dayChange?: number; dayChangePct?: number }> = {};
    const toFetch: string[] = [];
    for (const s of validSymbols) {
      const hit = priceCache.get(s);
      if (hit && hit.expiresAt > now) {
        prices[s] = { price: hit.price, source: hit.source, dayChange: hit.dayChange, dayChangePct: hit.dayChangePct };
      } else {
        toFetch.push(s);
      }
    }

    if (toFetch.length > 0) {
      // Try yfinance via Python subprocess (execFileSync — no shell, no injection)
      try {
        const { execFileSync } = await import("child_process");
        const pyScript = `
import json, sys
try:
    import yfinance as yf
    symbols = json.loads(sys.argv[1])
    result = {}
    for s in symbols:
        try:
            t = yf.Ticker(s)
            info = t.fast_info
            price = getattr(info, "last_price", None) or getattr(info, "previous_close", None)
            if price and price > 0:
                entry = {"price": float(price), "source": "yfinance"}
                prev = getattr(info, "previous_close", None)
                if prev and prev > 0:
                    entry["dayChange"] = round(float(price - prev), 4)
                    entry["dayChangePct"] = round(float((price - prev) / prev * 100), 4)
                result[s] = entry
        except Exception:
            pass
    print(json.dumps(result))
except ImportError:
    print(json.dumps({}))
`;
        const pyResult = execFileSync(
          "python3",
          ["-c", pyScript, JSON.stringify(toFetch)],
          { timeout: 15000, encoding: "utf-8" }
        ).trim();

        const yfPrices = JSON.parse(pyResult);
        const fetchedAt = Date.now() + PRICE_CACHE_TTL_MS;
        for (const [sym, val] of Object.entries(yfPrices)) {
          const entry = val as { price: number; source: string; dayChange?: number; dayChangePct?: number };
          prices[sym] = { price: entry.price, source: entry.source, dayChange: entry.dayChange, dayChangePct: entry.dayChangePct };
          priceCache.set(sym, { price: entry.price, source: entry.source, dayChange: entry.dayChange, dayChangePct: entry.dayChangePct, expiresAt: fetchedAt });
        }
      } catch (e: any) {
        console.warn("yfinance subprocess failed:", e.message?.slice(0, 100));
      }
    }

    usage.prices += 1;

    res.json({ prices, count: Object.keys(prices).length });
  } catch (err: any) {
    console.error("Price fetch error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// API: Analyze Portfolio and generate AI Rationale
// Public + authed: anonymous demo calls (no user) run the same deterministic +
// LLM analysis but skip audit persistence. Authed calls audit as before.
app.post("/api/portfolio/analyze", async (req, res) => {
  try {
    const user = req.user ?? null;
    const userId = user ? currentUser(req).id : null;
    const { snapshot, cashNeed, marketEvent, model, provider } = req.body as {
      snapshot: AccountSnapshot;
      cashNeed?: number;
      marketEvent?: MarketEvent;
      model?: string;
      provider?: string;
    };

    if (!snapshot || !snapshot.holdings) {
      return res.status(400).json({ error: "Missing required portfolio snapshot data." });
    }

    // Run deterministic calculation
    const deterministicResult = calculateOptimizer(snapshot, cashNeed || 0, marketEvent);

    let aiExplanation = "";
    let providerUsed = "deterministic";
    let modelUsed = "";

    const chain = buildProviderChain(provider, model);
    if (chain.length > 0) {
      const rationaleSystem = `You are the Liquidity & Tax Optimizer Agent (using model: ${model || "default"}). Be highly precise, objective, professional, and non-expert friendly. Do not use financial jargon without explaining it.

Strict Guardrails:
1. State plainly and once that you are not a licensed financial or tax advisor and this is not individualized advice. Do not omit or bury this.
2. If the account is in an active margin call (headroom < 0), lead with this fact prominently and clearly. Do not soften or bury it.
3. You never execute trades or transfers yourself. Remind the user that their approval is strictly required before any of these trades can be processed.
4. Never guarantee specific tax dollars saved. Speak only in terms of realized gains/losses.`;

      const rationalePrompt = `Analyze this portfolio snapshot and the tax-lot optimizer's output. Propose the single lowest-tax-cost way to free up funds based strictly on the optimizer's decisions.

Portfolio State:
- Collateral Value: $${(snapshot.holdings.reduce((sum, h) => sum + h.quantity * h.current_price, 0)).toLocaleString()}
- Loan Balance: $${snapshot.loan_balance.toLocaleString()}
- Maintenance LTV Limit: ${(snapshot.maintenance_ltv_limit * 100).toFixed(0)}%
- Headroom: $${deterministicResult.headroom_dollars.toLocaleString()}
- Cash Need Requested: $${(cashNeed || 0).toLocaleString()}
- Market Event context: ${marketEvent ? marketEvent.description : "None"}

Optimizer Decisions & Deterministic Results:
- Risk State: ${deterministicResult.risk_state}
- Recommended Action: ${deterministicResult.recommended_action}
- Resulting LTV: ${(deterministicResult.resulting_ltv_if_executed * 100).toFixed(1)}%
- Proposed Lots to Sell: ${JSON.stringify(deterministicResult.proposed_lots_to_sell, null, 2)}
- System Rationale: ${deterministicResult.rationale}

Generate a highly polished, short plain-English explanation (approx 2-3 paragraphs) explaining the action plan and why we chose these specific lots. Let the user know they can click 'Approve & Execute' in the UI to proceed.`;

      const result = await generateWithChain(
        chain,
        [{ role: "system", content: rationaleSystem }, { role: "user", content: rationalePrompt }]
      );
      if (result) {
        aiExplanation = result.text;
        providerUsed = result.provider;
        modelUsed = result.model;
        console.log(`[analyze] ${result.provider}/${result.model} rationale generation succeeded`);
      }
    }

    res.json({
      ...deterministicResult,
      ai_rationale: aiExplanation || deterministicResult.rationale,
      model_used: modelUsed || model || getRegistry().defaultModel,
      provider: providerUsed,
    });

    usage.analyze += 1;
    if (user) {
      await auditStore.save(toAuditRecord(userId!, snapshot, deterministicResult, providerUsed, "analyzed"));
    }
  } catch (err: any) {
    console.error("Analysis endpoint error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// API: Export full audit trail for a portfolio analysis
app.post("/api/portfolio/audit", requireAuth, async (req, res) => {
  try {
    const userId = currentUser(req).id;
    const { snapshot, cashNeed, marketEvent } = req.body as {
      snapshot: AccountSnapshot;
      cashNeed?: number;
      marketEvent?: MarketEvent;
    };

    if (!snapshot || !snapshot.holdings) {
      return res.status(400).json({ error: "Missing required portfolio snapshot data." });
    }

    const deterministicResult = calculateOptimizer(snapshot, cashNeed || 0, marketEvent);

    const auditTrail = {
      timestamp: new Date().toISOString(),
      input: {
        account: snapshot,
        cash_need: cashNeed || 0,
        market_event: marketEvent || null,
      },
      computed: {
        collateral_value: snapshot.holdings.reduce((sum, h) => sum + h.quantity * h.current_price, 0),
        loan_balance: snapshot.loan_balance,
        maintenance_ltv_limit: snapshot.maintenance_ltv_limit,
        cash: snapshot.cash,
        net_debt: snapshot.loan_balance - snapshot.cash,
        current_ltv: deterministicResult.current_ltv,
        headroom: deterministicResult.headroom_dollars,
        risk_state: deterministicResult.risk_state,
      },
      optimizer_output: {
        recommended_action: deterministicResult.recommended_action,
        proposed_lots: deterministicResult.proposed_lots_to_sell,
        resulting_ltv_if_executed: deterministicResult.resulting_ltv_if_executed,
        rationale: deterministicResult.rationale,
      },
      meta: {
        engine: "Collateral Deterministic Optimizer v1",
        formula: "Liquidation Required = Deficit / (1 - Maintenance LTV Limit)",
        wash_sale_detection: "Same-symbol-within-30-days (IRC Section 1091)",
      },
    };

    usage.audit += 1;
    await auditStore.save(toAuditRecord(userId, snapshot, deterministicResult, "deterministic", "exported"));

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="collateral-audit-${Date.now()}.json"`);
    res.json(auditTrail);
  } catch (err: any) {
    console.error("Audit endpoint error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// API: Live audit trail + usage stats (production-evidence / compliance view)
// Scoped to the authenticated user's own records.
app.get("/api/audit/live", requireAuth, async (req, res) => {
  try {
    const userId = currentUser(req).id;
    const records = await auditStore.listRecent(userId, 50);
    const providerBreakdown: Record<string, number> = {};
    for (const r of records) {
      providerBreakdown[r.provider] = (providerBreakdown[r.provider] || 0) + 1;
    }
    res.json({
      total_stored: records.length,
      provider_breakdown: providerBreakdown,
      usage,
      records,
    });
  } catch (err: any) {
    console.error("Audit live endpoint error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Admin API (all require an authenticated ADMIN session)
// ---------------------------------------------------------------------------

// Aggregate stats for the admin dashboard.
app.get("/api/admin/summary", requireAdmin, async (_req, res) => {
  try {
    const [users, portfolios, holdings, auditCount, audits] = await Promise.all([
      prisma.user.count(),
      prisma.portfolio.count(),
      prisma.holding.count(),
      prisma.auditTrail.count(),
      prisma.auditTrail.findMany({ orderBy: { id: "desc" }, take: 500 }),
    ]);

    const providerBreakdown: Record<string, number> = {};
    for (const a of audits) {
      providerBreakdown[a.provider] = (providerBreakdown[a.provider] || 0) + 1;
    }
    const riskBreakdown: Record<string, number> = {};
    for (const a of audits) {
      riskBreakdown[a.riskState] = (riskBreakdown[a.riskState] || 0) + 1;
    }
    const adminUsers = await prisma.user.count({ where: { role: "ADMIN" } });
    const sessionCount = await prisma.session.count();

    res.json({
      counts: { users, portfolios, holdings, audits: auditCount, admins: adminUsers, sessions: sessionCount },
      usage,
      provider_breakdown: providerBreakdown,
      risk_breakdown: riskBreakdown,
    });
  } catch (err: any) {
    console.error("Admin summary error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// List every user with a portfolio summary.
app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        portfolios: { include: { holdings: { include: { lots: true } } } },
        audits: { orderBy: { id: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        googleId: u.googleId,
        createdAt: u.createdAt.toISOString(),
        portfolios: u.portfolios.map((p) => ({
          id: p.id,
          cash: p.cash,
          loanBalance: p.loanBalance,
          maintenanceLtvLimit: p.maintenanceLtvLimit,
          holdings: p.holdings.length,
          updatedAt: p.updatedAt.toISOString(),
        })),
        lastAudit: u.audits[0]?.timestamp ?? null,
      })),
    });
  } catch (err: any) {
    console.error("Admin users error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Global audit trail across all users.
app.get("/api/admin/audit", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const records = await prisma.auditTrail.findMany({ orderBy: { id: "desc" }, take: limit });
    res.json({ records });
  } catch (err: any) {
    console.error("Admin audit error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Agent interactive chat / what-if simulations
app.post("/api/portfolio/chat", requireAuth, async (req, res) => {
  try {
    const { chatHistory, currentSnapshot, cashNeed, marketEvent, model, provider } = req.body as {
      chatHistory: { role: "user" | "model"; text: string }[];
      currentSnapshot: AccountSnapshot;
      cashNeed: number;
      marketEvent?: MarketEvent;
      model?: string;
      provider?: string;
    };

    if (!currentSnapshot) {
      return res.status(400).json({ error: "No portfolio snapshot provided for context." });
    }

    const deterministicResult = calculateOptimizer(currentSnapshot, cashNeed, marketEvent);

    const systemInstruction = `You are the Liquidity & Tax Optimizer Agent (running model: ${model || "default"}) for a portfolio-collateral monitoring product.
You watch the user's investment account, track their borrowing capacity against a maintenance LTV limit, and propose the single lowest-tax-cost way to free up funds.

Current Portfolio context:
- Collateral Value: $${(currentSnapshot.holdings.reduce((sum, h) => sum + h.quantity * h.current_price, 0)).toLocaleString()}
- Loan Balance: $${currentSnapshot.loan_balance.toLocaleString()}
- Maintenance LTV Limit: ${(currentSnapshot.maintenance_ltv_limit * 100).toFixed(0)}%
- Headroom: $${deterministicResult.headroom_dollars.toLocaleString()}
- Cash Need Requested: $${cashNeed.toLocaleString()}
- Risk State: ${deterministicResult.risk_state}
- Recommended Action: ${deterministicResult.recommended_action}
- Resulting LTV If Executed: ${(deterministicResult.resulting_ltv_if_executed * 100).toFixed(1)}%
- Proposed Lots to Sell: ${JSON.stringify(deterministicResult.proposed_lots_to_sell)}

Adhere to the following rules in every chat message:
1. Always state plainly and once that you are not a licensed financial or tax advisor and this is not individualized advice.
2. If the portfolio is in a margin call (headroom is negative), lead with this fact in your message immediately. It is an urgent state.
3. Never claim or imply you can execute trades. You must remind the user that we require human approval before any action is taken.
4. Explain the tax-lot selection logic when asked: we prioritize selling lots with unrealized losses first (ascending order) to offset gains and minimize tax impact.
5. If two lots of the same symbol were acquired within 30 days, highlight the wash-sale risk to the user.
6. Never guarantee specific tax savings. Speak in terms of capital losses harvested or realized gains avoided.
7. Be helpful, concise, and structured.
8. When explaining resulting LTV after a proposed sale, you MUST use the precomputed "Resulting LTV If Executed" field provided above — never calculate new LTV yourself. Collateral value decreases by the amount sold (shrinking-collateral feedback loop), and net debt = loan balance − cash. The optimizer already accounts for this correctly; re-deriving it freehand will produce wrong numbers. If the precomputed field is not available, say so rather than guessing.`;

    const messages = [
      { role: "system", content: systemInstruction },
      ...chatHistory.map((m) => ({ role: m.role === "model" ? "assistant" : m.role, content: m.text })),
    ];

    let responseText = "";
    let modelUsed = "";

    const chain = buildProviderChain(provider, model);
    if (chain.length > 0) {
      const result = await generateWithChain(chain, messages);
      if (result) {
        responseText = result.text;
        modelUsed = result.model;
        console.log(`[chat] ${result.provider}/${result.model} response succeeded`);
      }
    }

    if (!responseText) {
      responseText = "No LLM available (all providers exhausted). The deterministic optimizer results are shown in the dashboard.";
    }

    usage.chat += 1;

    res.json({ text: responseText, model_used: modelUsed || model || getRegistry().defaultModel });
  } catch (err: any) {
    console.error("Chat endpoint error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Setup Vite Dev Server / Serve Dist static assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Liquidity & Tax Optimizer Server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
