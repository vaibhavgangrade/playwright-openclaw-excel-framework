import { SelectorRegistry, DEFAULT_REGISTRY_PATH } from "../../src/registry/selector-registry.mjs";

const registry = new SelectorRegistry(DEFAULT_REGISTRY_PATH);

export async function resolveSelector(inputSelector) {
  return registry.resolveSelector(inputSelector);
}

export async function registerHeal({
  storyName,
  pageName,
  stepName,
  oldSelector,
  newSelector,
  reason,
  confidence,
}) {
  await registry.upsertMapping({
    storyName,
    pageName,
    stepName,
    oldSelector,
    newSelector,
    reason,
    confidence,
  });
  return { ok: true };
}

export async function listRegistry() {
  return registry.load();
}
