"""
conftest.py
-----------
Forces the test suite to run fully offline and deterministically, regardless
of any local `.env` file. Without this, a developer's real API key (e.g.
GROQ_API_KEY) would make the tests hit a live, rate-limited provider and hang.

Clearing the provider keys here happens *before* any test module imports
`src.config`/`src.app`, so `get_llm()` falls back to the from-scratch
offline engine (see src/scratch_engine.py).
"""

import os

# Set provider-key env vars to empty strings (rather than removing them) so
# that `src.config`'s `load_dotenv()` does NOT re-populate them from a local
# `.env` file (python-dotenv never overrides already-set vars). An empty string
# is falsy, so `get_llm()` treats it as "no key" and uses the offline engine.
for _key in (
    "GROQ_API_KEY",
    "GOOGLE_API_KEY",
    "OPENAI_API_KEY",
):
    os.environ[_key] = ""

# Also disable the optional API-key auth on the web layer during tests.
os.environ["API_KEY"] = ""

# Make sure Ollama is not auto-detected during tests (keeps them offline).
os.environ["OLLAMA_HOST"] = "http://127.0.0.1:1"  # unreachable -> offline
