export const storageKey = (userId: string, key: string) =>
  `nutrition:v2:${encodeURIComponent(userId)}:${key}`;

export function clearLegacyStorage() {
  // Remove only application-owned keys; unrelated browser storage is untouched.
  for (const name of ['sessionStorage', 'localStorage'] as const) {
    try {
      const storage = window[name];
      for (const key of Object.keys(storage)) {
        if (/^(ingredient-form-|food-form-|planning-|shopping-|cooking-)/.test(key))
          storage.removeItem(key);
      }
    } catch {
      /* Private browsing or denied storage: use memory only. */
    }
  }
}

export function compatible(value: unknown, base: unknown): boolean {
  if (base === null) return value === null || ['string', 'number'].includes(typeof value);
  if (Array.isArray(base)) return Array.isArray(value);
  if (typeof base === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(base as Record<string, unknown>).every(
      ([key, example]) =>
        !(key in value) ||
        (key === 'id' || key.endsWith('Id') || key.endsWith('_id')
          ? (value as Record<string, unknown>)[key] === null ||
            ['string', 'number'].includes(typeof (value as Record<string, unknown>)[key])
          : compatible((value as Record<string, unknown>)[key], example)),
    );
  }
  return typeof value === typeof base && (typeof value !== 'number' || Number.isFinite(value));
}

export function validWorkflow(key: string, value: unknown): boolean {
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const id = (v: unknown) => typeof v === 'string' || number(v);
  const entries = (v: unknown, check: (entry: unknown) => boolean) =>
    record(v) && Object.values(v).every(check);
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (key.endsWith(':planning-plan'))
    return (
      Array.isArray(value) &&
      value.every(
        (item) =>
          record(item) &&
          number(item.portions) &&
          (item.type === 'ingredient'
            ? id(item.ingredientId) && number(item.unitId) && number(item.amount)
            : item.type === 'food' &&
              id(item.foodId) &&
              entries(item.overrides, (v) => record(v) && number(v.unitId) && number(v.quantity))),
      )
    );
  if (key.endsWith(':cooking-completed-plan-keys')) return strings(value);
  if (key.endsWith(':planning-open-state') || key.endsWith(':shopping-excluded-items'))
    return entries(value, (v) => typeof v === 'boolean');
  if (key.endsWith(':cooking-actuals'))
    return (
      record(value) &&
      entries(value.portions, number) &&
      entries(value.ingredientTotals, (v) => record(v) && number(v.quantity) && number(v.unitId)) &&
      entries(
        value.foodAdjustments,
        (v) => record(v) && strings(v.removedIngredientIds) && strings(v.addedIngredientIds),
      )
    );
  if (key.endsWith(':ingredient-form-state-v1'))
    return (
      record(value) &&
      record(value.ingredient) &&
      typeof value.ingredient.name === 'string' &&
      Array.isArray(value.ingredient.units) &&
      value.ingredient.units.every(
        (v: unknown) => record(v) && typeof v.name === 'string' && Number.isFinite(Number(v.grams)),
      ) &&
      Array.isArray(value.ingredient.tags) &&
      value.ingredient.tags.every(record)
    );
  if (key.endsWith(':food-form-state-v1'))
    return (
      record(value) &&
      record(value.foodToEdit) &&
      typeof value.foodToEdit.name === 'string' &&
      Array.isArray(value.foodToEdit.ingredients) &&
      value.foodToEdit.ingredients.every(record) &&
      Array.isArray(value.foodToEdit.tags) &&
      value.foodToEdit.tags.every(record)
    );
  return true;
}
