---
name: selector-registry
description: Persist and reuse healed selectors across runs. Use before test generation and after successful healing to maintain organizational locator memory.
---

# Selector Registry Skill

This skill stores healed selector mappings in `artifacts/selector-registry.json`.

## Required behavior
1. Before test generation, resolve known selector replacements.
2. After healing, append or update `oldSelector -> newSelector` with reason and confidence.
3. Keep mappings reusable across stories and CI runs.
