import { describe, expect, it } from "vitest";

import { aggregateShoppingList } from "@/utils/shopping";
import type { PlanItem } from "@/utils/planningTypes";
import type { FoodRead, IngredientRead } from "@/utils/nutrition";

const buildIngredient = (
  overrides: Partial<IngredientRead> & { id: number; name: string },
): IngredientRead => ({
  is_shared: false,
  provenance_status: "unverified",
  nutrition: null,
  tags: [],
  units: [],
  ...overrides,
});

const buildFood = (
  overrides: Partial<FoodRead> & { id: number; name: string },
): FoodRead => ({
  ingredients: [],
  tags: [],
  ...overrides,
});

describe("aggregateShoppingList", () => {
  it("combines ingredient rows into a single total", () => {
    const oats: IngredientRead = buildIngredient({
      id: 1,
      name: "Oats",
      units: [
        { id: 10, ingredient_id: 1, name: "g", grams: 1 },
        { id: 11, ingredient_id: 1, name: "cup", grams: 90 },
      ],
      shopping_unit_id: 11,
    });

    const plan: PlanItem[] = [
      { type: "ingredient", ingredientId: "1", unitId: 10, amount: 200, portions: 1 },
      { type: "ingredient", ingredientId: "1", unitId: 11, amount: 1.5, portions: 1 },
    ];

    const { items, issues } = aggregateShoppingList({
      plan,
      foods: [],
      ingredients: [oats],
    });

    expect(issues).toHaveLength(0);
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.name).toBe("Oats");
    // 200 g + (1.5 * 90 g)
    expect(item.totalGrams).toBeCloseTo(335);
    expect(item.unitTotals).toHaveLength(2);
    const cupTotal = item.unitTotals.find((u) => u.unitName === "cup");
    expect(cupTotal?.quantity).toBeCloseTo(1.5);
    const gramTotal = item.unitTotals.find((u) => u.unitName === "g");
    expect(gramTotal?.quantity).toBeCloseTo(200);
    expect(item.preferredUnitTotal).not.toBeNull();
    expect(item.preferredUnitTotal?.unitName).toBe("cup");
    expect(item.preferredUnitTotal?.quantity).toBeCloseTo(335 / 90);
  });

  it("includes food ingredients scaled by portions and overrides", () => {
    const chicken: IngredientRead = buildIngredient({
      id: 2,
      name: "Chicken",
      units: [
        { id: 20, ingredient_id: 2, name: "g", grams: 1 },
        { id: 21, ingredient_id: 2, name: "oz", grams: 28.35 },
      ],
      shopping_unit_id: 21,
    });

    const broccoli: IngredientRead = buildIngredient({
      id: 3,
      name: "Broccoli",
      units: [
        { id: 30, ingredient_id: 3, name: "g", grams: 1 },
      ],
      shopping_unit_id: 30,
    });

    const stirFry: FoodRead = buildFood({
      id: 100,
      name: "Chicken Stir Fry",
      ingredients: [
        { food_id: 100, ingredient_id: 2, unit_id: 21, unit_quantity: 5 },
        { food_id: 100, ingredient_id: 3, unit_id: 30, unit_quantity: 120 },
      ],
    });

    const plan: PlanItem[] = [
      {
        type: "food",
        foodId: "100",
        portions: 2,
        overrides: {
          "2": { unitId: 20, quantity: 150 },
        },
      },
    ];

    const { items, issues } = aggregateShoppingList({
      plan,
      foods: [stirFry],
      ingredients: [chicken, broccoli],
    });

    expect(issues).toHaveLength(0);
    expect(items).toHaveLength(2);

    const chickenTotal = items.find((item) => item.name === "Chicken");
    expect(chickenTotal).toBeDefined();
    // Override uses grams: 150 g per portion * 2 portions = 300 g
    expect(chickenTotal?.totalGrams).toBeCloseTo(300);

    const broccoliTotal = items.find((item) => item.name === "Broccoli");
    expect(broccoliTotal).toBeDefined();
    // Default quantity 120 g per portion * 2 portions = 240 g
    expect(broccoliTotal?.totalGrams).toBeCloseTo(240);
    expect(broccoliTotal?.preferredUnitTotal?.unitName).toBe("g");
    expect(broccoliTotal?.preferredUnitTotal?.quantity).toBeCloseTo(240);
  });

  it("reports issues when data is missing", () => {
    const plan: PlanItem[] = [
      { type: "ingredient", ingredientId: "1", unitId: 99, amount: 1, portions: 1 },
      { type: "food", foodId: "200", portions: 1, overrides: {} },
    ];

    const { items, issues } = aggregateShoppingList({
      plan,
      foods: [],
      ingredients: [],
    });

    expect(items).toHaveLength(0);
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.some((issue) => issue.type === "missing-ingredient")).toBe(true);
    expect(issues.some((issue) => issue.type === "missing-food")).toBe(true);
  });

  it("falls back to plan totals when no preferred unit is set", () => {
    const salt: IngredientRead = buildIngredient({
      id: 5,
      name: "Salt",
      units: [{ id: 50, ingredient_id: 5, name: "tsp", grams: 6 }],
    });

    const plan: PlanItem[] = [
      { type: "ingredient", ingredientId: "5", unitId: 50, amount: 2, portions: 1 },
    ];

    const { items } = aggregateShoppingList({
      plan,
      foods: [],
      ingredients: [salt],
    });

    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item.preferredUnitTotal).toBeNull();
    expect(item.unitTotals).toHaveLength(1);
    expect(item.unitTotals[0]?.unitName).toBe("tsp");
  });
});
