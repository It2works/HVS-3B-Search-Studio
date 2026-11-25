# HVS-3B Studio Contract

## Run file (runs/<episode_id>/episode.json, images beside it as step_<t>.jpg)
{
  "id": "ep_20261121_ab12",
  "created_at": "ISO-8601",
  "model": "hvs-3b | hvs-3b-sft | mock",
  "task": "HOS | HPS",
  "instruction": "look for the red exit sign",
  "pano": { "id": "pano_x", "width": 4096, "height": 2048, "file": "panorama.jpg" },
  "config": { "fov": 90, "view_px": 448, "max_steps": 8, "context_turns": 2,
              "start": { "yaw": 0, "pitch": 0 }, "prompt_sha": "..." },
  "ground_truth": { "yaw": 123, "pitch": 5 } | null,
  "steps": [ { "t": 1, "pose": { "yaw": 0, "pitch": 0 }, "image": "step_1.jpg",
               "raw": "<think>..</think><answer>rotate(70,0)</answer>",
               "think": "...", "action": { "type": "rotate", "dyaw": 70, "dpitch": 0 },
               "parse_ok": true, "latency_ms": 2310 } ],
  "result": { "status": "submitted | max_steps | error | cancelled",
              "final": { "yaw": 190, "pitch": 4 } | null,
              "success": true | false | null, "error": null | "message" }
}

Action types: rotate {dyaw,dpitch}, submit {yaw,pitch}, invalid.

## REST (all under /api, header X-API-Key)
- GET /health returns GPUs and models [{id,label,loaded,device}].
- POST /panoramas (multipart) returns {pano_id,width,height}. GET /panoramas/{id}/image.
- POST /episodes with {pano_id, task, instruction, model, start?, max_steps?, fov?, ground_truth?} returns {episode_id}.
- GET /episodes/{id}/events is SSE. GET /episodes/{id} returns the run file. GET /episodes lists summaries. POST /episodes/{id}/cancel.
- GET /episodes/{id}/steps/{t}/image returns the JPEG the model saw.
- POST /compare with {...episode fields, models:[a,b]} returns {comparison_id, episodes:[id,id]}.
- GET /bench/cases?task&difficulty&limit, POST /bench/runs, GET /bench/runs/{id} (progress + per-model success rate), GET /bench/runs/{id}/episodes.

## SSE events (JSON in data)
episode_started, step_started {t,pose}, step_completed {step} (same shape as a run-file step), episode_finished {result}, error {message}.

## Math
Shared by both sides: pixel direction d = fwd + right*x + up*y; lon = atan2(dx,dz), lat = atan2(dy, hypot(dx,dz)); u = (lon/2π + 0.5)·W (yaw 0 is the center column), v = (0.5 − lat/π)·H.
