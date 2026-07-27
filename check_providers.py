#!/usr/bin/env python3
"""Pre-flight health check for LLM providers.

Run before a demo to verify which providers are available:
  python check_providers.py
"""

import os
import sys
import requests
from dotenv import load_dotenv

load_dotenv(".env.local")

providers = {
    "Zyloo": {
        "url": "https://api.zyloo.io/v1/chat/completions",
        "key_env": "ZYLOO_API_KEY",
        "model": "gemini-3-flash-preview-free",
    },
    "OpenRouter": {
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "key_env": "OPENROUTER_API_KEY",
        "model": "google/gemma-4-26b-a4b-it:free",
    },
    "Poolside": {
        "url": "https://inference.poolside.ai/v1/chat/completions",
        "key_env": "POOLSIDE_API_KEY",
        "model": "poolside/laguna-s-2.1",
        "extra": {"thinking": {"type": "disabled"}},
    },
}

print("=" * 50)
print("  COLLATERAL — LLM Provider Health Check")
print("=" * 50)
print()

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
if any_ok:
    print("  At least one provider is healthy. Demo is safe to run.")
else:
    print("  WARNING: No providers responded. Deterministic fallback only.")
print()
