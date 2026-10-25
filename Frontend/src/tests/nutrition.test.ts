import { describe, expect, it } from "vitest";

import {
  createIngredientLookup,
  findIngredientInLookup,
  macrosForFood,
  macrosForIngredientPortion,
  scaleMacroTotals,
  ZERO_MACROS,
  UNKNOWN_MACROS,
  sumMacroTotals,
} from "@/utils/nutrition";
import type { FoodRead, IngredientRead } from "@/utils/nutrition";

type IngredientOverrides = Record<string, unknown>;

type IngredientFixtureOptions = IngredientOverrides & {
  id?: number;
};

const makeIngredient = (overrides: IngredientFixtureOptions = {}): IngredientRead => ({
  id: overrides.id ?? 1,
  name: "Fixture Ingredient",
  nutrition: {
    calories: 1,
    protein: 1,
    fat: 1,
    carbohydrates: 1,
    fiber: 1,
    ...(overrides.nutrition as Record<string, unknown> | undefined),
  } as unknown as IngredientRead["nutrition"],
  units: (overrides.units as IngredientRead["units"]) ?? ([
    { id: 1, name: "gram", grams: 1 },
  ] as unknown as IngredientRead["units"]),
  tags: [],
  ...overrides,
} as unknown as IngredientRead);

describe("macrosForIngredientPortion", () => {
  it("uses null units and parses string fields", () => {
    const ingredient = makeIngredient({
      units: [
        { id: null, name: "serving", grams: 2 },
        { id: 10, name: "cup", grams: 3 },
      ] as unknown as IngredientRead["units"],
      nutrition: {
        calories: "0.5",
        protein: "1.25",
        fat: "2",
        carbohydrates: "3",
        fiber: "0.4",
      } as unknown as IngredientRead["nutrition"],
    });

    const result = macrosForIngredientPortion({
      ingredient,
      unitId: null,
      quantity: "1.5",
    });

    expect(result.calories).toBeCloseTo(1.5);
    expect(result.protein).toBeCloseTo(3.75);
    expect(result.fat).toBeCloseTo(6);
    expect(result.carbs).toBeCloseTo(9);
    expect(result.fiber).toBeCloseTo(1.2);
  });

  it("falls back to 1g units when the target is missing", () => {
    const ingredient = makeIngredient({
      nutrition: {
        calories: 4,
        protein: 5,
        fat: 6,
        carbohydrates: 7,
        fiber: 8,
      } as unknown as IngredientRead["nutrition"],
      units: [
        { id: 20, name: "large", grams: 50 },
        { id: 21, name: "gram", grams: 1 },
      ] as unknown as IngredientRead["units"],
    });

    const result = macrosForIngredientPortion({
      ingredient,
      unitId: "missing",
      quantity: 3,
    });

    expect(result).toEqual({
      calories: 12,
      protein: 15,
      fat: 18,
      carbs: 21,
      fiber: 24,
    });
  });

  it("returns unknown macros for malformed input values", () => {
    const ingredient = makeIngredient({
      units: [
        { id: 30, name: "mystery", grams: "invalid" },
      ] as unknown as IngredientRead["units"],
      nutrition: {
        calories: "bad",
        protein: null,
        fat: undefined,
        carbohydrates: "",
        fiber: "NaN",
      } as unknown as IngredientRead["nutrition"],
    });

    const result = macrosForIngredientPortion({
      ingredient,
      unitId: 30,
      quantity: "not-a-number",
    });

    expect(result).toEqual(UNKNOWN_MACROS);
  });

  it("treats USDA nutrition as rounded per-gram base values for larger portions", () => {
    const ingredient = makeIngredient({
      id: 303,
      name: "Banana USDA",
      nutrition: {
        calories: 0.89,
        protein: 0.01,
        fat: 0,
        carbohydrates: 0.23,
        fiber: 0.03,
      } as unknown as IngredientRead["nutrition"],
      units: [
        { id: 31, name: "gram", grams: 1 },
      ] as unknown as IngredientRead["units"],
    });

    const result = macrosForIngredientPortion({
      ingredient,
      unitId: 31,
      quantity: 100,
    });

    expect(result).toEqual({
      calories: 89,
      protein: 1,
      fat: 0,
      carbs: 23,
      fiber: 3,
    });
  });

  it("continues to scale per-gram USDA nutrition through non-gram units", () => {
    const ingredient = makeIngredient({
      id: 404,
      name: "Apple slices USDA",
      nutrition: {
        calories: 0.52,
        protein: 0,
        fat: 0,
        carbohydrates: 0.14,
        fiber: 0.02,
      } as unknown as IngredientRead["nutrition"],
      units: [
        { id: 40, name: "gram", grams: 1 },
        { id: 41, name: "cup sliced", grams: 109 },
      ] as unknown as IngredientRead["units"],
    });

    const result = macrosForIngredientPortion({
      ingredient,
      unitId: 41,
      quantity: 1,
    });

    expect(result.calories).toBeCloseTo(56.68);
    expect(result.protein).toBeCloseTo(0);
    expect(result.fat).toBeCloseTo(0);
    expect(result.carbs).toBeCloseTo(15.26);
    expect(result.fiber).toBeCloseTo(2.18);
  });

});

describe("createIngredientLookup and findIngredientInLookup", () => {
  it("stores ingredients under numeric and string ids", () => {
    const ingredient = makeIngredient({ id: 42 });
    const lookup = createIngredientLookup([ingredient]);

    expect(lookup.get(42)).toBe(ingredient);
    expect(lookup.get("42")).toBe(ingredient);
    expect(findIngredientInLookup(lookup, 42)).toBe(ingredient);
    expect(findIngredientInLookup(lookup, "42")).toBe(ingredient);
  });

  it("normalizes lookup ids and handles missing values", () => {
    const ingredient = makeIngredient({ id: 7 });
    const lookup = createIngredientLookup([ingredient]);

    expect(findIngredientInLookup(lookup, "  ")).toBeUndefined();
    expect(findIngredientInLookup(lookup, "not-a-number")).toBeUndefined();
    expect(findIngredientInLookup(lookup, 999)).toBeUndefined();
  });
});

describe("scaleMacroTotals", () => {
  it("scales totals with positive multipliers", () => {
    const totals = { calories: 10, protein: 5, fat: 2, carbs: 3, fiber: 1 };
    expect(scaleMacroTotals(totals, 2)).toEqual({
      calories: 20,
      protein: 10,
      fat: 4,
      carbs: 6,
      fiber: 2,
    });
  });

  it("returns zero totals when multiplier is invalid", () => {
    const totals = { calories: 10, protein: 5, fat: 2, carbs: 3, fiber: 1 };
    expect(scaleMacroTotals(totals, 0)).toEqual(ZERO_MACROS);
    expect(scaleMacroTotals(totals, Number.NaN)).toEqual(UNKNOWN_MACROS);
    expect(scaleMacroTotals(totals, -1)).toEqual(UNKNOWN_MACROS);
  });
});

describe("macrosForFood", () => {
  const ingredientA = makeIngredient({
    id: 101,
    nutrition: {
      calories: 2,
      protein: 3,
      fat: 4,
      carbohydrates: 5,
      fiber: 6,
    } as unknown as IngredientRead["nutrition"],
    units: [
      { id: 11, name: "half", grams: 0.5 },
      { id: 12, name: "gram", grams: 1 },
    ] as unknown as IngredientRead["units"],
  });

  const ingredientB = makeIngredient({
    id: 202,
    nutrition: {
      calories: 10,
      protein: 0,
      fat: 1,
      carbohydrates: 2,
      fiber: 0,
    } as unknown as IngredientRead["nutrition"],
    units: [
      { id: 21, name: "double", grams: 2 },
    ] as unknown as IngredientRead["units"],
  });

  const lookup = createIngredientLookup([ingredientA, ingredientB]);

  it("sums macros and applies overrides", () => {
    const food = {
      id: 1,
      name: "Fixture Food",
      ingredients: [
        { ingredient_id: ingredientA.id, unit_id: 11, unit_quantity: 2 },
        { ingredient_id: ingredientB.id, unit_id: 21, unit_quantity: 1.5 },
      ],
    } as unknown as FoodRead;

    const overrides = {
      [String(ingredientA.id)]: { unitId: 12, quantity: 3 },
    };

    const result = macrosForFood(food, lookup, overrides);

    expect(result).toEqual({
      calories: 36,
      protein: 9,
      fat: 15,
      carbs: 21,
      fiber: 18,
    });
  });

  it("returns unknown macros when food data is missing", () => {
    expect(macrosForFood(undefined, lookup)).toEqual(UNKNOWN_MACROS);
    expect(macrosForFood({ id: 2, name: "Empty" } as FoodRead, lookup)).toEqual(
      UNKNOWN_MACROS,
    );
  });
});

describe("nutrient uncertainty", () => {
  it("propagates missing values independently through portions, recipes and totals", () => {
    const ingredient = makeIngredient({ nutrition: { calories: 2, protein: null, fat: 0, carbohydrates: 3, fiber: null } });
    const portion = macrosForIngredientPortion({ ingredient, quantity: 10 });
    expect(portion).toEqual({ calories: 20, protein: null, fat: 0, carbs: 30, fiber: null });
    const food = { ingredients: [{ ingredient_id: ingredient.id, unit_quantity: 10 }] } as FoodRead;
    const recipe = macrosForFood(food, createIngredientLookup([ingredient]));
    expect(recipe).toEqual(portion);
    expect(sumMacroTotals([recipe, { calories: 5, protein: 9, fat: 0, carbs: 2, fiber: 1 }]))
      .toEqual({ calories: 25, protein: null, fat: 0, carbs: 32, fiber: null });
    expect(scaleMacroTotals(portion, 0)).toEqual(ZERO_MACROS);
    expect(scaleMacroTotals(portion, 0.5).protein).toBeNull();
  });
  it("does not present a partial recipe as a complete total", () => {
    const food = { ingredients: [{ ingredient_id: 999, unit_quantity: 10 }] } as FoodRead;
    expect(macrosForFood(food, new Map())).toEqual(UNKNOWN_MACROS);
  });
});
