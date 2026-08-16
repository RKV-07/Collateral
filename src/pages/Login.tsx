import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { loginWithPassword, ApiError } from "../api";
import { useAuth } from "../useAuth";

export default function Login() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await loginWithPassword(email, password);
      await refresh();
      navigate(user.role === "ADMIN" ? "/admin" : "/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Login failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface text-[#E0E0E0] font-sans flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="bg-platter border border-line rounded-2xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <span className="p-2.5 bg-white/5 text-white/80 rounded-xl border border-line">
              <KeyRound size={18} />
            </span>
            <div>
              <h1 className="text-lg font-medium text-white tracking-tight">Sign in</h1>
              <p className="text-[11px] text-white/40 font-mono">Admin credential login</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="block">
              <span className="text-[11px] font-medium text-white/50 uppercase tracking-wider">Email</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1.5 w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/40"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-white/50 uppercase tracking-wider">Password</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 w-full bg-surface border border-line rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/40"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-black rounded-lg text-sm font-semibold hover:bg-white/90 transition disabled:opacity-60 cursor-pointer"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Sign in
            </button>
          </form>
        </div>

        <div className="mt-5 text-center text-xs text-white/40">
          <a href="/auth/google" className="inline-flex items-center gap-1.5 hover:text-white transition">
            <ShieldCheck size={12} />
            Or sign in with Google
          </a>
          <span className="mx-2 text-white/20">·</span>
          <Link to="/" className="hover:text-white transition">Back home</Link>
        </div>
      </div>
    </div>
  );
}
