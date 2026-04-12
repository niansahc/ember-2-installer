# Installer Performance Audit — pre-v0.15.0

**Date:** 2026-04-12
**Auditor:** Claude Code (Yellow repo)
**Scope:** Clean install flow, launch to Done screen

---

## Install Flow Timing Breakdown

All steps run **strictly sequentially** (`app.js:1163`, one `await` per step). Total time = sum of all steps.

| Step | What it does | Estimated time | Notes |
|------|-------------|----------------|-------|
| **Prereq checks** | Probe 5 binaries sequentially | 2–5s | `main.js:287–313`, each `await probe()` blocks the next |
| **Prereq install (winget)** | `winget install` per missing package | 5–15 min **each** | Sequential, no parallelism. Docker alone ~10 min |
| **Clone ember-2** | `git clone` (full history) | 30–60s | `main.js:396–428`, not shallow |
| **Write .env** | Write config file | <1s | |
| **Create venv** | `python -m venv .venv` | 5–10s | |
| **pip install** | `pip install -r requirements.txt` | 5–15 min | Includes torch (~2.5 GB download). `main.js:747` |
| **API key setup** | Read from OS credential store | <1s | nonFatal |
| **Model download** | `ollama pull <model>` | 10–30 min | 4.1–9.1 GB depending on model selection |
| **Embedding model** | `ollama pull nomic-embed-text` | 1–3 min | ~270 MB, always required |
| **Vision model** | `ollama pull <vision-model>` | 5–15 min | 6.4–8 GB, optional, nonFatal |
| **Clone ember-2-ui** | `git clone` inside build-ui step | 15–30s | `main.js:792–806`, full history |
| **npm ci** | Install UI dependencies | 1–3 min | `main.js:810–820` |
| **npm run build** | Vite production build | 30s–2 min | `main.js:849–859` |
| **Copy dist/** | Copy built UI into ember-2/ui/ | <1s | |
| **Docker start** | Start Docker daemon + `docker compose up -d` | 30s–5 min | `main.js:750–784`, polls every 3s up to 60s |
| **Health check** | Poll `/api/health` every 2s | 2–30s | `app.js:1414–1419`, 15 attempts max |
| **Startup task** | schtasks / launchd / systemd | <1s | All platforms fast |

### Total estimated clean install time

| Scenario | Time |
|----------|------|
| All prereqs present, model pre-installed | **8–25 min** (pip + UI build + Docker) |
| All prereqs present, model needs download (qwen3:8b) | **20–45 min** |
| Missing 3+ prereqs on Windows | **45–90 min** |
| Worst case (nothing installed, large model + vision) | **60–120 min** |

---

## Top 3 Slowest Steps

### 1. Ollama model pull — 10–30 min

**Location:** `main.js:650–662` (handler), `app.js:1118–1124` (step), `app.js:662–688` (UI)

**Why it's slow:** Raw download size. Default model qwen3:8b = 4.9 GB, largest option phi4:14b = 9.1 GB. Embedding model adds another ~270 MB. Vision model adds 6.4–8 GB. All are single-threaded HTTP downloads through Ollama's CLI — no parallelism, no resume.

**Optimization opportunities:**
- **Parallel model + embed pull:** The main model and nomic-embed-text are independent downloads that could run concurrently. Currently sequential (`app.js:1118–1131`). Saving ~1–3 min.
- **Shallow model pre-check:** Skip the pull entirely if the model is already present (currently done, but the check + pull are still sequential with other steps).
- **Background pull during later steps:** Start the model pull early (after venv creation) and let it download in the background while pip and build-ui run. This is the single biggest possible improvement — pip and model-pull are completely independent.

### 2. pip install requirements.txt — 5–15 min

**Location:** `main.js:747` (within `run-install-step` venv case), `app.js:1114` (step definition)

**Why it's slow:** The requirements file includes PyTorch (~2.5 GB download), sentence-transformers, and other ML dependencies. pip resolves the full dependency tree, downloads all wheels, and installs sequentially. On first install there's no cache.

**Optimization opportunities:**
- **Pre-built wheel cache:** Ship a bundled wheel cache for the heaviest packages (torch, numpy, scipy). Avoids re-downloading ~3 GB on every clean install. Adds installer package size but saves 3–8 min.
- **pip --no-deps for known-good lockfile:** If a pip freeze lockfile is committed, `pip install --no-deps -r lockfile.txt` skips dependency resolution entirely. Saves 30–60s of solver time.
- **Parallel with model pull:** pip and ollama pull are fully independent. Running them concurrently would hide the shorter one behind the longer one.

### 3. Winget prerequisite installs (Windows) — 5–15 min each, up to 60+ min total

**Location:** `main.js:338–364` (handler), `app.js` prereq install buttons

**Why it's slow:** Each `winget install` is invoked sequentially. Docker Desktop alone is ~500 MB and takes 5–10 min. If Git, Python, Node, Ollama, and Docker all need installing, five sequential winget invocations can take 30–60 min.

**Optimization opportunities:**
- **Parallel winget installs:** Git, Python, Node, and Ollama have no install-time dependencies on each other. Only Docker Desktop may require a reboot/re-login. These four could be installed in parallel via `Promise.all()`, reducing wall-clock time from ~40 min to ~15 min (bounded by the slowest single install).
- **Batch winget:** `winget install --id Git.Git --id Python.Python.3.12 --id OpenJS.NodeJS.LTS --id Ollama.Ollama` — winget supports multiple `--id` flags in a single invocation, which MAY parallelize internally.
- **Pre-flight size estimate:** Show the user estimated download sizes before starting, so they know what they're waiting for.

---

## Additional Observations

### Sequential chains that could be parallelized

| Currently sequential | Could be parallel | Estimated saving |
|---------------------|-------------------|-----------------|
| Prereq probe × 5 | `Promise.all([probe('python'), probe('docker'), ...])` | 2–4s |
| pip install → model pull | Run concurrently (independent) | 5–15 min (bounded by longer) |
| Model pull → embed pull | Run concurrently (both Ollama) | 1–3 min |
| Clone ember-2-ui → npm ci → npm build | Clone during pip install (independent) | 15–30s |

### Git clones are full (not shallow)

Both `git clone` invocations (`main.js:396–428`, `main.js:792–806`) clone full repository history. Using `--depth 1` would reduce clone time and bandwidth, especially as the repos grow. Current ember-2 repo is ~50 MB full clone; shallow would be ~5–10 MB.

**Trade-off:** Shallow clones complicate `git describe --tags` used for version detection (`main.js:178`). Would need `--tags` flag during clone or a fallback.

### Health check polling is well-tuned

The Done screen polls at 2s intervals for 15 attempts (30s max). The retry path uses 3s intervals for 20 attempts (60s max). Both are reasonable. The pre-check for an already-running API (`app.js:1644`) avoids spawning duplicate processes. No optimization needed.

### Startup task creation is instant

All three platforms (schtasks, launchd, systemd) complete in under 1 second. No bottleneck.

---

## Recommended Priority for v0.15.0

1. **Parallelize pip + model pull** — highest impact, lowest risk. These are completely independent operations. Estimated saving: 5–15 min on a typical clean install.
2. **Parallelize winget installs** — high impact for first-time Windows users. Estimated saving: 15–30 min when 3+ prereqs are missing.
3. **Shallow git clones** — small but free improvement. Add `--depth 1 --branch main` to both clone commands. Estimated saving: 20–40s.

---

## What NOT to optimize

- **npm ci + npm run build** — already fast (2–5 min combined), and npm ci requires the clone to finish first. Not worth the complexity of further parallelization.
- **Docker compose up** — depends on Docker daemon being ready. Already polls correctly. Can't meaningfully speed up.
- **Health check polling** — already well-tuned intervals. Tightening the poll interval below 2s gains nothing (API boot time is the bottleneck, not poll frequency).
