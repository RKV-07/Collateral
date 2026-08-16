import React, { useState, useRef, useEffect } from "react";
import { ChatMessage, AccountSnapshot } from "../types";
import { Send, Sparkles, User, RefreshCw, MessageSquare } from "lucide-react";

interface ChatAssistantProps {
  currentSnapshot: AccountSnapshot;
  cashNeed: number;
  marketEventDescription: string;
  selectedModel?: string;
  provider?: string;
}

export default function ChatAssistant({ currentSnapshot, cashNeed, marketEventDescription, selectedModel = "gemini-3-flash-preview", provider = "gemini" }: ChatAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "model",
      text: "Hello! I am your Liquidity & Tax Optimizer Agent. I monitor your portfolio leverage, safeguard against maintenance margin limits, and help you unlock cash with the minimum possible tax impact. Ask me anything about your LTV headroom, tax lots, or how potential market events could affect your compliance status.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const suggestedQuestions = [
    "Why are we selling loss-making lots first?",
    "What is a wash sale and is there any risk here?",
    "How does the maintenance limit scale my sell orders?",
    "What happens if my tech holdings drop by 30%?",
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: "user", text: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/portfolio/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatHistory: [...messages, userMsg],
          currentSnapshot,
          cashNeed,
          marketEvent: marketEventDescription ? { description: marketEventDescription } : undefined,
          provider,
          model: selectedModel,
        }),
      });

      const data = await response.json();
      if (response.ok && data.text) {
        setMessages((prev) => [...prev, { role: "model", text: data.text }]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            text: `Error contacting optimization model: ${data.error || "Please check server status."}`,
          },
        ]);
      }
    } catch (err) {
      console.error("Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "model",
          text: "I was unable to reach the advisor model. Make sure you have loaded the environment or started the full-stack server correctly. But feel free to continue simulating and testing portfolio changes!",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div id="advisor-chat-container" className="bg-platter border border-line rounded-2xl p-6 flex flex-col h-[520px] shadow-xl">
      <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="p-1.5 bg-white text-black rounded-lg">
            <MessageSquare size={16} />
          </span>
          <div>
            <h3 className="font-sans font-medium text-base text-white">Interactive Advisor Desk</h3>
            <p className="text-xs text-white/40 font-mono mt-0.5">Ask strategy, tax-harvesting, or custom what-if queries</p>
          </div>
        </div>
        <span className="px-2.5 py-1 bg-white/5 border border-line text-white/60 font-mono text-[10px] rounded-md uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles size={11} className="text-amber-400" />
          {selectedModel}
        </span>
      </div>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-4 mb-4 text-xs scrollbar-thin">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex gap-2.5 w-full max-w-[85%] ${
              m.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
            }`}
          >
            <div className={`p-1.5 rounded-full shrink-0 h-6 w-6 flex items-center justify-center text-[10px] ${
              m.role === "user" ? "bg-white/10 text-white" : "bg-white text-black"
            }`}>
              {m.role === "user" ? <User size={12} /> : <Sparkles size={12} />}
            </div>
            <div className={`p-3 rounded-2xl leading-relaxed whitespace-pre-wrap ${
              m.role === "user" 
                ? "bg-white/5 border border-line text-white/90 rounded-tr-none" 
                : "bg-platter border border-white/5 text-white/95 rounded-tl-none"
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-2 items-center text-white/30 font-mono text-[11px] pl-8">
            <RefreshCw size={12} className="animate-spin text-white/40" />
            Agent processing scenario...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Chips */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {suggestedQuestions.map((q, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(q)}
            disabled={isLoading}
            className="px-2.5 py-1 bg-platter hover:bg-white/5 border border-line rounded-lg text-[10px] font-medium text-white/60 hover:text-white transition text-left cursor-pointer"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Chat Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(input);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          placeholder="Ask about wash-sales, LTV, custom market changes..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          className="flex-1 text-xs bg-platter text-white border border-line rounded-xl px-4 py-2.5 focus:outline-none focus:border-white/30"
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="p-2.5 bg-white hover:bg-white/90 disabled:bg-platter disabled:text-white/20 text-black rounded-xl transition cursor-pointer flex items-center justify-center"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
