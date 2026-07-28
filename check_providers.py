#!/usr/bin/env python3
"""Pre-flight health check for LLM providers and integrations.

Run before a demo to verify everything is ready:
  python check_providers.py
"""

import os
import sys
import requests
from dotenv import load_dotenv

load_dotenv(".env.local")

providers = {
    "Groq": {
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "key_env": "GROQ_API_KEY",
        "model": "llama-3.3-70b-versatile",
    },
    "Poolside": {
        "url": "https://inference.poolside.ai/v1/chat/completions",
        "key_env": "POOLSIDE_API_KEY",
        "model": "poolside/laguna-s-2.1",
        "extra": {"thinking": {"type": "disabled"}},
    },
    "OpenRouter": {
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "key_env": "OPENROUTER_API_KEY",
        "model": "google/gemma-4-26b-a4b-it:free",
    },
}

print("=" * 50)
print("  COLLATERAL — Pre-Flight Health Check")
print("=" * 50)
print()

# --- LLM Providers ---
print("  LLM Providers")
print("  " + "-" * 30)
any_ok = False
for name, cfg in providers.items():
    api_key = os.environ.get(cfg["key_env"], "")
    if not api_key:
        print(f"  {name:12s}  SKIP  (no {cfg['key_env']} set)")
        continue

    try:
        body = {
            "model": cfg["model"],
            "messages": [{"role": "user", "content": "Say hi"}],
            "max_tokens": 10,
        }
        if "extra" in cfg:
            body.update(cfg["extra"])

        resp = requests.post(
            cfg["url"],
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=15,
        )
        if resp.status_code == 200:
            print(f"  {name:12s}  OK    (model: {cfg['model']})")
            any_ok = True
        else:
            print(f"  {name:12s}  FAIL  (HTTP {resp.status_code}: {resp.text[:80]})")
    except Exception as e:
        print(f"  {name:12s}  ERROR ({e})")

print()

# --- yfinance ---
print("  Data Sources")
print("  " + "-" * 30)
try:
    import yfinance as yf
    ticker = yf.Ticker("AAPL")
    price = ticker.fast_info.last_price
    if price and price > 0:
        print(f"  yfinance     OK    (AAPL last price: ${price:.2f})")
    else:
        print(f"  yfinance     WARN  (got no price data for AAPL)")
except Exception as e:
    print(f"  yfinance     ERROR ({e})")

print()

# --- Slack Webhook ---
print("  Notifications")
print("  " + "-" * 30)
webhook_url = os.environ.get("SLACK_WEBHOOK_URL", "")
if not webhook_url:
    print("  Slack         SKIP  (no SLACK_WEBHOOK_URL set)")
else:
    try:
        # Slack webhooks accept POST; sending a minimal empty payload
        # triggers a 400 (no_text) which confirms the webhook is reachable
        resp = requests.post(webhook_url, json={}, timeout=10)
        if resp.status_code in (200, 400):
            print(f"  Slack         OK    (webhook reachable)")
        else:
            print(f"  Slack         WARN  (HTTP {resp.status_code}: {resp.text[:60]})")
    except Exception as e:
        print(f"  Slack         ERROR ({e})")

print()

# --- Summary ---
print("  " + "=" * 30)
if any_ok:
    print("  At least one LLM provider is healthy. Demo is safe to run.")
else:
    print("  WARNING: No LLM providers responded. Deterministic fallback only.")
print()
