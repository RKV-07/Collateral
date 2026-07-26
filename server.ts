import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { calculateOptimizer, getAdjustedSnapshot } from "./src/utils.js";
import { AccountSnapshot, MarketEvent } from "./src/types.js";

// Load environment variables
dotenv.config({ path: ".env.local" });

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialize Gemini client
let aiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// Check if Gemini is configured
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
  });
});

// API: Analyze Portfolio and generate Gemini Rationale
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

    let geminiExplanation = "";
    const selectedModel = model || "gemini-2.5-flash";

    // Generate smart rationale via Gemini if key is present
    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = getGemini();
        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: `Analyze this portfolio snapshot and the tax-lot optimizer's output. Propose the single lowest-tax-cost way to free up funds based strictly on the optimizer's decisions.

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

Role & Tone:
You are the Liquidity & Tax Optimizer Agent (using model: ${selectedModel}). Be highly precise, objective, professional, and non-expert friendly. Do not use financial jargon without explaining it.

Strict Guardrails to follow:
1. State plainly and once that you are not a licensed financial or tax advisor and this is not individualized advice. Do not omit or bury this.
2. If the account is in an active margin call (headroom < 0), lead with this fact prominently and clearly. Do not soften or bury it.
3. You never execute trades or transfers yourself. Remind the user that their approval is strictly required before any of these trades can be processed.
4. Never guarantee specific tax dollars saved. Speak only in terms of realized gains/losses.

Generate a highly polished, short plain-English explanation (approx 2-3 paragraphs) explaining the action plan and why we chose these specific lots. Let the user know they can click 'Approve & Execute' in the UI to proceed.`,
        });

        geminiExplanation = response.text || "";
      } catch (geminiError: any) {
        console.error("Gemini rationale generation failed:", geminiError);
        geminiExplanation = `Failed to generate AI rationale using model ${selectedModel}: ${geminiError.message || geminiError}. Using fallback calculated explanation.`;
      }
    }

    res.json({
      ...deterministicResult,
      gemini_rationale: geminiExplanation || deterministicResult.rationale,
      model_used: selectedModel,
    });
  } catch (err: any) {
    console.error("Analysis endpoint error:", err);
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
    const selectedModel = model || "gemini-2.5-flash";

    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        text: "I am running in local offline mode because no Gemini API key was detected in the workspace secrets. However, our deterministic optimizer continues to function! Feel free to adjust the cash need or trigger market events using the control dashboard.",
        model_used: selectedModel,
      });
    }

    const ai = getGemini();

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
7. Be helpful, concise, and structured.`;

    // Map chat history to standard GoogleGenAI format
    const contents = chatHistory.map((m) => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents,
      config: {
        systemInstruction,
      },
    });

    res.json({ text: response.text, model_used: selectedModel });
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
