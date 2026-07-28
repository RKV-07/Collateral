import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { calculateOptimizer, getAdjustedSnapshot } from "./src/utils.js";
import { AccountSnapshot, MarketEvent } from "./src/types.js";

// Load environment variables
dotenv.config({ path: ".env.local" });

const app = express();
const PORT = 3000;

app.use(express.json());

// Groq API helper (OpenAI-compatible — fast inference, free tier ~14,400 req/day)
async function generateViaGroq(
  messages: { role: string; content: string }[],
  model: string = "llama-3.3-70b-versatile"
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("No GROQ_API_KEY available");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: 2048 }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// OpenRouter fallback
async function generateViaOpenRouter(prompt: string, systemInstruction?: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("No OPENROUTER_API_KEY available");

  const messages: { role: string; content: string }[] = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  messages.push({ role: "user", content: prompt });

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemma-4-26b-a4b-it:free",
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// Poolside fallback (Laguna S 2.1)
async function generateViaPoolside(prompt: string, systemInstruction?: string): Promise<string> {
  const apiKey = process.env.POOLSIDE_API_KEY;
  if (!apiKey) throw new Error("No POOLSIDE_API_KEY available");

  const messages: { role: string; content: string }[] = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  messages.push({ role: "user", content: prompt });

  const res = await fetch("https://inference.poolside.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "poolside/laguna-s-2.1",
      messages,
      thinking: { type: "disabled" },
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Poolside ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// Check if providers are configured
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasGroqKey: !!process.env.GROQ_API_KEY,
    hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
    hasPoolsideKey: !!process.env.POOLSIDE_API_KEY,
  });
});

// API: Fetch live market prices via yfinance (Python subprocess)
app.post("/api/portfolio/prices", async (req, res) => {
  try {
    const { symbols } = req.body as { symbols: string[] };
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: "Missing or empty symbols array." });
    }

    const uniqueSymbols = [...new Set(symbols.map(s => s.toUpperCase()))];
    const prices: Record<string, { price: number; source: string }> = {};

    // Try yfinance via Python subprocess
    try {
      const { execSync } = await import("child_process");
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
                result[s] = {"price": float(price), "source": "yfinance"}
        except Exception:
            pass
    print(json.dumps(result))
except ImportError:
    print(json.dumps({}))
`;
      const pyResult = execSync(
        `python3 -c '${pyScript}' '${JSON.stringify(uniqueSymbols)}'`,
        { timeout: 15000, encoding: "utf-8" }
      ).trim();

      const yfPrices = JSON.parse(pyResult);
      Object.assign(prices, yfPrices);
    } catch (e: any) {
      console.warn("yfinance subprocess failed:", e.message?.slice(0, 100));
    }

    res.json({ prices, count: Object.keys(prices).length });
  } catch (err: any) {
    console.error("Price fetch error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// API: Analyze Portfolio and generate AI Rationale
app.post("/api/portfolio/analyze", async (req, res) => {
  try {
    const { snapshot, cashNeed, marketEvent, model } = req.body as {
      snapshot: AccountSnapshot;
      cashNeed?: number;
      marketEvent?: MarketEvent;
      model?: string;
    };

    if (!snapshot || !snapshot.holdings) {
      return res.status(400).json({ error: "Missing required portfolio snapshot data." });
    }

    // Run deterministic calculation
    const deterministicResult = calculateOptimizer(snapshot, cashNeed || 0, marketEvent);

    let aiExplanation = "";
    let providerUsed = "deterministic";
    const selectedModel = model || "llama-3.3-70b-versatile";

    // Generate smart rationale via Groq if key is present
    if (process.env.GROQ_API_KEY) {
      try {
        const rationaleSystem = `You are the Liquidity & Tax Optimizer Agent (using model: ${selectedModel}). Be highly precise, objective, professional, and non-expert friendly. Do not use financial jargon without explaining it.

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

        aiExplanation = await generateViaGroq([
          { role: "system", content: rationaleSystem },
          { role: "user", content: rationalePrompt },
        ], selectedModel);
        providerUsed = "groq";
        console.log("Groq rationale generation succeeded");
      } catch (groqError: any) {
        console.error("Groq rationale generation failed, trying OpenRouter:", groqError.message);
      }
    }

    // Fallback: OpenRouter if Groq failed or unavailable
    if (!aiExplanation && process.env.OPENROUTER_API_KEY) {
      try {
        aiExplanation = await generateViaOpenRouter(
          `Analyze this portfolio and propose the lowest-tax-cost way to free up funds.\n\n` +
          `Risk State: ${deterministicResult.risk_state}\n` +
          `Headroom: $${deterministicResult.headroom_dollars.toLocaleString()}\n` +
          `Proposed Lots: ${JSON.stringify(deterministicResult.proposed_lots_to_sell, null, 2)}\n` +
          `Rationale: ${deterministicResult.rationale}\n\n` +
          `Generate a short plain-English explanation (2-3 paragraphs) of the action plan.`
        );
        providerUsed = "openrouter";
        console.log("OpenRouter fallback succeeded");
      } catch (orError: any) {
        console.error("OpenRouter fallback failed:", orError.message);
      }
    }

    // Fallback: Poolside if OpenRouter also failed or unavailable
    if (!aiExplanation && process.env.POOLSIDE_API_KEY) {
      try {
        aiExplanation = await generateViaPoolside(
          `Analyze this portfolio and propose the lowest-tax-cost way to free up funds.\n\n` +
          `Risk State: ${deterministicResult.risk_state}\n` +
          `Headroom: $${deterministicResult.headroom_dollars.toLocaleString()}\n` +
          `Proposed Lots: ${JSON.stringify(deterministicResult.proposed_lots_to_sell, null, 2)}\n` +
          `Rationale: ${deterministicResult.rationale}\n\n` +
          `Generate a short plain-English explanation (2-3 paragraphs) of the action plan.`
        );
        providerUsed = "poolside";
        console.log("Poolside fallback succeeded");
      } catch (psError: any) {
        console.error("Poolside fallback failed:", psError.message);
      }
    }

    res.json({
      ...deterministicResult,
      ai_rationale: aiExplanation || deterministicResult.rationale,
      model_used: selectedModel,
      provider: providerUsed,
    });
  } catch (err: any) {
    console.error("Analysis endpoint error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// API: Export full audit trail for a portfolio analysis
app.post("/api/portfolio/audit", async (req, res) => {
  try {
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

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="collateral-audit-${Date.now()}.json"`);
    res.json(auditTrail);
  } catch (err: any) {
    console.error("Audit endpoint error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// API: Agent interactive chat / what-if simulations
app.post("/api/portfolio/chat", async (req, res) => {
  try {
    const { chatHistory, currentSnapshot, cashNeed, marketEvent, model } = req.body as {
      chatHistory: { role: "user" | "model"; text: string }[];
      currentSnapshot: AccountSnapshot;
      cashNeed: number;
      marketEvent?: MarketEvent;
      model?: string;
    };

    if (!currentSnapshot) {
      return res.status(400).json({ error: "No portfolio snapshot provided for context." });
    }

    const deterministicResult = calculateOptimizer(currentSnapshot, cashNeed, marketEvent);
    const selectedModel = model || "llama-3.3-70b-versatile";

    const systemInstruction = `You are the Liquidity & Tax Optimizer Agent (running model: ${selectedModel}) for a portfolio-collateral monitoring product.
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

    let responseText = "";

    // Try Groq first
    if (process.env.GROQ_API_KEY) {
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          ...chatHistory.map((m) => ({ role: m.role === "model" ? "assistant" : m.role, content: m.text })),
        ];
        responseText = await generateViaGroq(messages, selectedModel);
        console.log("Groq chat succeeded");
      } catch (groqError: any) {
        console.error("Groq chat failed, trying OpenRouter:", groqError.message);
      }
    }

    // Fallback: OpenRouter if Groq failed or unavailable
    if (!responseText && process.env.OPENROUTER_API_KEY) {
      try {
        const userMessage = chatHistory.map((m) => `${m.role}: ${m.text}`).join("\n");
        responseText = await generateViaOpenRouter(
          `Portfolio context:\n- Risk State: ${deterministicResult.risk_state}\n- Headroom: $${deterministicResult.headroom_dollars.toLocaleString()}\n- Recommended Action: ${deterministicResult.recommended_action}\n\nUser conversation:\n${userMessage}`,
          systemInstruction
        );
        console.log("OpenRouter chat fallback succeeded");
      } catch (orError: any) {
        console.error("OpenRouter chat fallback failed:", orError.message);
      }
    }

    // Fallback: Poolside if OpenRouter also failed or unavailable
    if (!responseText && process.env.POOLSIDE_API_KEY) {
      try {
        const userMessage = chatHistory.map((m) => `${m.role}: ${m.text}`).join("\n");
        responseText = await generateViaPoolside(
          `Portfolio context:\n- Risk State: ${deterministicResult.risk_state}\n- Headroom: $${deterministicResult.headroom_dollars.toLocaleString()}\n- Recommended Action: ${deterministicResult.recommended_action}\n\nUser conversation:\n${userMessage}`,
          systemInstruction
        );
        console.log("Poolside chat fallback succeeded");
      } catch (psError: any) {
        console.error("Poolside chat fallback failed:", psError.message);
      }
    }

    if (!responseText) {
      responseText = "No LLM available (all providers exhausted). The deterministic optimizer results are shown in the dashboard.";
    }

    res.json({ text: responseText, model_used: selectedModel });
  } catch (err: any) {
    console.error("Chat endpoint error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Setup Vite Dev Server / Serve Dist static assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Liquidity & Tax Optimizer Server listening on http://localhost:${PORT}`);
  });
}

startServer();
