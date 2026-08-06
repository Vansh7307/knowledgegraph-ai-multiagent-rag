# TODO — Dual answer engine (API key + from-scratch)

- [x] Understand the existing architecture (dual-provider: API-key path + OfflineLLM)
- [x] Present & get plan approval
- [x] Create `src/scratch_engine.py` — from-scratch answer engine (scoring + citations)
- [x] Upgrade `OfflineLLM` in `src/llm_provider.py` to use the scratch engine
- [x] Add `tests/test_scratch_engine.py` + `tests/conftest.py` (force offline, no hang)
- [x] Update `README.md` to document the improved offline engine
- [x] Run `python -m pytest tests/ -v` — all 19 tests pass, no hang
