# HVS-3B Search Studio - Architecture & Rules

## Key decisions
1. Contract first. docs/CONTRACT.md defines the run-file JSON and the API. Frontend and backend are built against it in parallel.
2. Replay first, live second. Every episode is saved as JSON plus step images. The frontend can replay saved runs with no GPU, so the demo survives a dead Kaggle session. Live mode is an extra.
3. Server owns the loop. The backend renders views, calls the model, parses, and updates the pose. The browser never sees model URLs or keys.
4. Models are injected. The notebook already has both models in memory. The backend exposes create_app(adapters) so the notebook passes the loaded models in. No double loading.
5. One adapter interface. generate(messages, images) -> str. Implementations: TransformersAdapter (default), OpenAICompatAdapter (vLLM later), MockAdapter (tests and UI work without GPU).
6. Never fabricate. If the official prompt file is missing the backend must refuse to run a live episode with a clear error, not fall back to a made-up prompt.

## Repo rules
- Monorepo: backend/ (Python 3.10+, FastAPI, pydantic v2, numpy, opencv-python-headless, pillow, sse-starlette, pytest) and frontend/ (Vite, React 18, TypeScript strict, React Router, TanStack Query).
- Small commits, one concern each. No dead code, no TODO stubs presented as done.
- Every module has tests. Angle math and parsing are tested with edge cases (wrap-around at 0/360, pitch clamp, malformed output).
- Never commit secrets. API key comes from env HVS_API_KEY.
- Frontend: follow the installed UI skills for design. Accessible, keyboard-usable, responsive, with real empty, loading and error states.
- After each task, report: what changed, how it was verified (commands and output), and anything left open.
