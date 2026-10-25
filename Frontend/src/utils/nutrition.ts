import type { components } from "@/api-types";

export type IngredientRead = components["schemas"]["IngredientRead"];
export type FoodRead = components["schemas"]["FoodRead"];
export type FoodIngredient = components["schemas"]["FoodIngredient"];

export type MacroTotals = {
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  fiber: number | null;
};

export type IngredientLookup = Map<string | number, IngredientRead>;

export type IngredientPortionInput = {
  ingredient: IngredientRead;
  unitId?: number | null | string;
  quantity?: number | null | string;
};

export type FoodOverride = {
  unitId?: number | null;
  quantity?: number | null;
};

export type MacroTargets = { [K in keyof MacroTotals]: number };

export const ZERO_TARGETS: MacroTargets = {
  calories: 0,
  protein: 0,
  fat: 0,
  carbs: 0,
  fiber: 0,
};

export const ZERO_MACROS: MacroTotals = { ...ZERO_TARGETS };

export const UNKNOWN_MACROS: MacroTotals = { calories: null, protein: null, fat: null, carbs: null, fiber: null };

export const parseNutrient = (value: unknown): number | null => {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
export const addNutrient = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a == null || b == null ? null : a + b;
export const scaleNutrient = (value: number | null | undefined, multiplier: number): number | null => {
  if (!Number.isFinite(multiplier) || multiplier < 0) return null;
  // No quantity contributes zero, even when its composition is unknown.
  if (multiplier === 0) return 0;
  return value == null ? null : value * multiplier;
};

const ONE_GRAM = 1;

type IngredientUnitBase = NonNullable<IngredientRead["units"]>[number];
type NormalizedIngredientUnit = IngredientUnitBase & { grams: number };
type IngredientUnitMaybeGrams = IngredientUnitBase & { grams?: number | string | null };
type IngredientNutrition = NonNullable<IngredientRead["nutrition"]>;
type NutritionFields = {
  calories?: number | string | null;
  protein?: number | string | null;
  fat?: number | string | null;
  carbohydrates?: number | string | null;
  fiber?: number | string | null;
};

const normalizeId = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return String(value);
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const readUnitGrams = (unit?: IngredientUnitBase | null): number => {
  if (!unit) return 0;
  const maybeUnit = unit as IngredientUnitMaybeGrams;
  return toNumber(maybeUnit.grams);
};

const normalizeUnit = (unit: IngredientUnitBase): NormalizedIngredientUnit => ({
  ...unit,
  grams: parseNutrient((unit as IngredientUnitMaybeGrams).grams) ?? NaN,
});

const resolveUnit = (
  units: IngredientRead["units"],
  targetUnitId: unknown,
): NormalizedIngredientUnit | undefined => {
  if (!units || units.length === 0) return undefined;
  const normalizedTarget = normalizeId(targetUnitId);
  if (normalizedTarget === null) {
    const nullUnit = units.find((unit) => unit.id === null || unit.id === undefined);
    if (nullUnit) return normalizeUnit(nullUnit);
  } else {
    const match = units.find((unit) => normalizeId(unit.id) === normalizedTarget);
    if (match) return normalizeUnit(match);
  }

  const gramUnit = units.find((unit) => readUnitGrams(unit) === ONE_GRAM);
  if (gramUnit) return normalizeUnit(gramUnit);

  return normalizeUnit(units[0]!);
};

const normalizeNutrition = (
  nutrition: IngredientRead["nutrition"],
): IngredientNutrition => {
  const safeNutrition = nutrition ?? ({} as IngredientNutrition);
  const fields = safeNutrition as NutritionFields;
  return {
    ...safeNutrition,
    calories: parseNutrient(fields.calories),
    protein: parseNutrient(fields.protein),
    fat: parseNutrient(fields.fat),
    carbohydrates: parseNutrient(fields.carbohydrates),
    fiber: parseNutrient(fields.fiber),
  } as IngredientNutrition;
};

const addMacro = (totals: MacroTotals, delta: MacroTotals): MacroTotals => ({
  calories: addNutrient(totals.calories, delta.calories),
  protein: addNutrient(totals.protein, delta.protein),
  fat: addNutrient(totals.fat, delta.fat),
  carbs: addNutrient(totals.carbs, delta.carbs),
  fiber: addNutrient(totals.fiber, delta.fiber),
});

export const addMacroTotals = addMacro;

export const sumMacroTotals = (
  values: MacroTotals[],
): MacroTotals => values.reduce(addMacro, { ...ZERO_MACROS });

export const scaleMacroTotals = (
  totals: MacroTotals,
  multiplier: number,
): MacroTotals => {
  const safeMultiplier = multiplier;
  if (safeMultiplier === 0) {
    return { ...ZERO_MACROS };
  }

  return {
    calories: scaleNutrient(totals.calories, safeMultiplier),
    protein: scaleNutrient(totals.protein, safeMultiplier),
    fat: scaleNutrient(totals.fat, safeMultiplier),
    carbs: scaleNutrient(totals.carbs, safeMultiplier),
    fiber: scaleNutrient(totals.fiber, safeMultiplier),
  };
};

export const macrosForIngredientPortion = (
  { ingredient, unitId, quantity }: IngredientPortionInput,
): MacroTotals => {
  if (!ingredient) return { ...UNKNOWN_MACROS };

  const unit = resolveUnit(ingredient.units ?? [], unitId);
  const gramsPerUnit = unit?.grams ?? NaN;
  const normalizedNutrition = normalizeNutrition(ingredient.nutrition);
  const normalizedQuantity = quantity === undefined || quantity === null
    ? 0
    : parseNutrient(quantity) ?? NaN;

  return {
    calories: scaleNutrient(normalizedNutrition.calories, gramsPerUnit * normalizedQuantity),
    protein: scaleNutrient(normalizedNutrition.protein, gramsPerUnit * normalizedQuantity),
    fat: scaleNutrient(normalizedNutrition.fat, gramsPerUnit * normalizedQuantity),
    carbs: scaleNutrient(normalizedNutrition.carbohydrates, gramsPerUnit * normalizedQuantity),
    fiber: scaleNutrient(normalizedNutrition.fiber, gramsPerUnit * normalizedQuantity),
  };
};

export const gramsForIngredientPortion = ({
  ingredient,
  unitId,
  quantity,
}: IngredientPortionInput): number => {
  if (!ingredient) return 0;

  const unit = resolveUnit(ingredient.units ?? [], unitId);
  const gramsPerUnit = unit?.grams ?? 0;
  const normalizedQuantity = quantity === undefined || quantity === null
    ? 0
    : toNumber(quantity);

  return gramsPerUnit * normalizedQuantity;
};

export const findIngredientInLookup = (
  ingredientMap: IngredientLookup,
  ingredientId: unknown,
): IngredientRead | undefined => {
  if (!ingredientMap) return undefined;

  if (typeof ingredientId === "number" || typeof ingredientId === "string") {
    const direct = ingredientMap.get(ingredientId);
    if (direct) return direct;
  }

  const normalized = normalizeId(ingredientId);
  if (normalized === null) return undefined;

  const byString = ingredientMap.get(normalized);
  if (byString) return byString;

  const numeric = Number(normalized);
  if (Number.isNaN(numeric)) return undefined;
  return ingredientMap.get(numeric);
};

export const macrosForFood = (
  food: FoodRead | undefined,
  ingredientMap: IngredientLookup,
  overrides?: Record<string | number, FoodOverride>,
): MacroTotals => {
  if (!food || !Array.isArray(food.ingredients)) return { ...UNKNOWN_MACROS };

  return food.ingredients.reduce((totals, foodIngredient) => {
    const ingredient = findIngredientInLookup(ingredientMap, foodIngredient.ingredient_id);
    if (!ingredient) return addMacro(totals, UNKNOWN_MACROS);

    const overrideKey = normalizeId(foodIngredient.ingredient_id);
    const override = overrideKey !== null ? overrides?.[overrideKey] : undefined;
    const portionMacros = macrosForIngredientPortion({
      ingredient,
      unitId: override?.unitId ?? foodIngredient.unit_id,
      quantity: override?.quantity ?? foodIngredient.unit_quantity,
    });
    return addMacro(totals, portionMacros);
  }, { ...ZERO_MACROS });
};

export const createIngredientLookup = (
  ingredients: IngredientRead[] | undefined,
): IngredientLookup => {
  const map: IngredientLookup = new Map();
  if (!ingredients) return map;
  ingredients.forEach((ingredient) => {
    const { id } = ingredient;
    if (id === null || id === undefined) return;
    map.set(id, ingredient);
    map.set(String(id), ingredient);
  });
  return map;
};
