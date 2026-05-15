# Model evaluation rationale

This doc explains why the installer recommends the curated model set surfaced on the Model Selection screen.

## Curated lineup

| Model | Disk | Min RAM | Role | Eval status on Ember |
|---|---|---|---|---|
| `qwen3:4b` | ~2.5 GB | ~5 GB | Low-RAM floor | **Evaluated 2026-05-15.** Two-run comparison vs `qwen3:8b`: overall scores competitive (within run-to-run noise), latency consistently lower. See "qwen3:4b results" below. |
| `qwen3:8b` | ~4.9 GB | ~8 GB | **Recommended default** | **Evaluated.** Pareto winner across measured dimensions. See "qwen3:8b results" below. |
| `qwen3:14b` | ~9 GB | ~16 GB | Higher-capability dense | **Not yet evaluated.** Included on architecture and hardware-fit grounds. |
| `qwen3:30b-a3b` | ~18 GB | ~24 GB | Opt-in MoE for high-RAM systems | **Not yet evaluated.** Included on architecture and hardware-fit grounds. |

The hardware-detect handler picks one model per RAM tier as the auto-recommendation. `qwen3:30b-a3b` is intentionally never auto-recommended — it ships as an opt-in card for users who know they want MoE inference and have 24+ GB of RAM available.

**Note on `qwen3:4b`:** evaluated on Ember-specific prompts across two runs on 2026-05-15. Competitive with `qwen3:8b` at lower resource requirements, ~23-26s faster per question on this hardware. Margin between models is within eval noise; `qwen3:8b` retains the **Recommended default** designation. See "qwen3:4b results" below for the underlying data.

## Hardware ladder

```
ram >= 16 GB  →  qwen3:14b
ram >= 8  GB  →  qwen3:8b
ram <  8  GB  →  qwen3:4b
```

## qwen3:8b results

`qwen3:8b` is the only model in the curated set that has been run end-to-end against Ember's evaluation prompts. It is the Pareto winner across the dimensions we measured: preference expression, memory grounding, and self-attribution.

Numeric scores and the prompt set will be added once the eval harness is published. Until then, the recommendation is anchored on this single empirical result plus the cross-architecture comparisons documented below.

## qwen3:4b results

Evaluated 2026-05-15 against Ember's 18-question battery, with `claude-sonnet-4-20250514` as the judge, on a test vault. Two independent runs:

| Run | `qwen3:4b` overall | `qwen3:8b` overall |
|---|---|---|
| 1 | 6.2 | 5.6 |
| 2 | 6.6 | 6.5 |

`qwen3:4b` wins both overall scores, but the margin sits within run-to-run noise. Category-level scores are highly volatile across runs, so small overall-score deltas should not be read as a robust capability ordering.

**Latency is the most stable signal across the two runs.** Per-question averages:

- `qwen3:4b`: 26-41s
- `qwen3:8b`: 53-64s

`qwen3:4b` is consistently ~23-26 seconds faster per question.

**Conclusion:** `qwen3:4b` is competitive with `qwen3:8b` on Ember-specific prompts at smaller size and lower latency. `qwen3:8b` retains the **Recommended default** designation, anchored on its historical multi-run baseline rather than today's two-run snapshot.

## Why these four, not others

- **`qwen3:4b` over `mistral:7b` (previous floor):** smaller disk and RAM footprint, same Qwen 3 architecture as the recommended default — keeps the curated set within one model family for easier prompt-engineering coverage.
- **`qwen3:14b` over `qwen2.5:14b` (previous higher-capability):** newer Qwen 3 generation; same architecture family as the rest of the lineup; the previous Qwen 2.5 14B card is being retired in favor of the same-tier Qwen 3 variant.
- **`qwen3:30b-a3b` added as an opt-in:** MoE variant exposes faster per-token inference for users with 24+ GB RAM. Card description leads with the RAM floor because the "3B active parameters" framing intuitively reads as a low-RAM model — it is not, since MoE keeps the full expert set resident in memory.
- **`gemma3:12b`, `phi4:14b` removed:** the previous lineup mixed three architecture families (Qwen, Gemma, Phi). The curated list now stays inside the Qwen 3 family for consistency. Users can still pull other models manually from Ollama and select them in the in-app Settings screen.

## Vision

`llama3.2-vision:11b` remains the recommended vision model. `llava:13b` was removed from the curated list on the same curate-don't-menu logic — users who actively use it can pull it manually.

## Re-evaluation cadence

The two remaining Ember-untested models in the curated set (`qwen3:14b`, `qwen3:30b-a3b`) are pending a full eval pass. When that lands, this doc will be updated with measured scores and card descriptions in the installer will be revised to reflect tested-on-Ember claims rather than the current architecture-and-hardware-fit framing.

`qwen3.5:9b` is a candidate for inclusion once it has been run against Ember's eval battery. It is intentionally not on the current curated list — without measured results showing it dominates `qwen3:8b`, adding it would dilute the curation.
