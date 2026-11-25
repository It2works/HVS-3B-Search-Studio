# Kaggle notebook — HVS-3B Search Studio

**Notebook settings:** GPU **T4 x2** (one model per GPU), **Internet ON**, and add
`HVS_API_KEY` under *Secrets* in the notebook settings panel.

> **Session limits:** Kaggle GPU sessions end after **12 hours** and can be
> reclaimed earlier when idle. The **trycloudflare.com URL changes on every
> session** — after a restart, re-run the cells and copy the new URL into the
> frontend. Saved `runs/` survive in `/kaggle/working` for that session only, so
> export the zip (last cell) before the session ends. Replay mode in the frontend
> does not need the tunnel or a GPU.

Copy `kaggle/run_studio.py` into the notebook working directory, or clone the
repo and put its `kaggle/` folder on `sys.path` as in the first cell. The helper
imports are lazy, so importing it before the backend is installed is safe.

---

### Cell 0 — import the helper

```python
import sys, os
from pathlib import Path

REPO = "/kaggle/working/HVS-3B"          # change to your clone path
sys.path.insert(0, os.path.join(REPO, "kaggle"))
import run_studio as studio
```

### Cell 1 — kill stale uvicorn / cloudflared processes

Prevents `address already in use` and `Text file busy` after a re-run.

```python
studio.kill_existing_processes(port=8000)
```

### Cell 2 — install cloudflared (not pre-installed on Kaggle)

```python
cloudflared_path = studio.install_cloudflared()
print(cloudflared_path)
```

Under the hood this is `wget` of the Linux amd64 binary plus `chmod +x`:

```bash
# equivalent shell steps, shown for reference
# !wget -q -O /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
# !chmod +x /usr/local/bin/cloudflared
```

### Cell 3 — install the backend from the uploaded zip (or a git URL)

The zip must contain `pyproject.toml` and `hvs_backend/` at its root. Add the
`backend.zip` as a Kaggle **dataset** named `hvs-backend-zip`.

```python
!pip install /kaggle/input/hvs-backend-zip/backend.zip
```

Alternative, if you host the repo instead:

```python
# !pip install "git+https://github.com/<org>/<repo>.git#subdirectory=backend"
```

```python
studio.verify_backend_installed()
```

### Cell 4 — load the API key from Kaggle Secrets

```python
API_KEY = studio.get_api_key("HVS_API_KEY")
FRONTEND_ORIGIN = "https://your-frontend.vercel.app"   # or http://localhost:5173
RUNS_DIR = Path("/kaggle/working/runs")
RUNS_DIR.mkdir(parents=True, exist_ok=True)
print("Key loaded; never printed or written to disk.")
```

### Cell 5 — models are already loaded (no loading code here)

This assumes the notebook has already loaded and moved the models:

- `model_sft`, `proc_sft` on **cuda:0**
- `model_rl`, `proc_rl` on **cuda:1**

```python
# Loaded earlier in the notebook — do NOT reload them here.
assert model_sft is not None and proc_sft is not None
assert model_rl is not None and proc_rl is not None
print("Injected models ready on cuda:0 and cuda:1")
```

### Cell 6 — wrap the adapters and build the app

```python
from hvs_backend.api import create_app

adapters = studio.build_adapters(
    model_sft, proc_sft, model_rl, proc_rl,
    device_sft="cuda:0", device_rl="cuda:1",
    max_new_tokens=512,
)
app = create_app(adapters, RUNS_DIR, API_KEY, FRONTEND_ORIGIN)
print("adapters:", sorted(adapters))
```

### Cell 7 — install the official prompt (user-provided, never invented)

Point this at the prompt file you uploaded as a Kaggle dataset. The cell raises
and stops the notebook if the file is missing or empty.

```python
OFFICIAL_PROMPT_SRC = "/kaggle/input/agent-prompts/official.txt"   # <-- your path
PROMPT_PATH = studio.install_official_prompt(OFFICIAL_PROMPT_SRC)
print(PROMPT_PATH)
```

### Cell 8 — start uvicorn + tunnel, print the public URL and curl command

```python
handle = studio.start_studio(
    app, API_KEY,
    tunnel=True,
    host="127.0.0.1",
    port=8000,
)
```

The cell prints something like:

```
Public URL: https://calm-lakes-1234.trycloudflare.com

Ready. Health-check command (paste into a notebook cell):
!curl -H "X-API-Key: $HVS_API_KEY" https://calm-lakes-1234.trycloudflare.com/api/health
```

Paste that printed `!curl ...` line into the next cell to confirm the API is up.

To stop cleanly before re-running:

```python
handle.stop()
```

### Cell 9 — export `runs/` for the frontend demo-runs folder

```python
zip_path = studio.export_runs(RUNS_DIR)   # /kaggle/working/hvs_runs.zip
print(zip_path)
```

Download `hvs_runs.zip` from the Kaggle **Output** tab, unzip it, and place the
episode folders into the frontend's demo-runs directory (for example
`frontend/public/demo-runs/`). Each folder contains `episode.json`,
`panorama.jpg` and `step_<t>.jpg`, so the replay UI needs no GPU and no tunnel.

---

## Panorama upload

The Play page includes a **Panorama** file input. It reads the chosen JPEG/PNG with
`FileReader` and sends it as `pano_base64` (a `data:image/...;base64,...` string) in the
`POST /api/run` JSON body. The prototype backend already decodes that field and falls
back to `DEFAULT_PANORAMA` when it is absent. No backend change is needed for upload.

The frontend also accepts this prototype's SSE names: `thinking` (ignored), `step`
(with `image_url`, `latency_ms`), `episode_finished` (with `final`), and `error`.

---

## Operational notes

- Re-run cells **1 → 9** in order after a session restart. The tunnel URL changes
  every time; update the frontend's API base URL with the new
  `trycloudflare.com` host.
- The 12-hour session limit means live episodes are a demo extra — rely on
  exported `runs/` for anything that must survive the session.
- Never paste `HVS_API_KEY` into a cell or commit it; it stays in Kaggle Secrets
  and is read into `os.environ` only at runtime.
- A missing or empty official prompt is a hard failure (HTTP 400 from the API);
  there is deliberately no fallback prompt.
