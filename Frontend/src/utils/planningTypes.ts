import type { MacroTargets } from "@/utils/nutrition";

export type FoodOverride = {
  unitId: number;
  quantity: number;
};

export type FoodPlanItem = {
  type: "food";
  foodId: string;
  portions: number;
  overrides: Record<string, FoodOverride>;
};

export type IngredientPlanItem = {
  type: "ingredient";
  ingredientId: string;
  unitId: number;
  amount: number;
  portions: number;
};

export type PlanItem = FoodPlanItem | IngredientPlanItem;

export type PlanPayload = {
  days: number;
  targetMacros: MacroTargets;
  plan: PlanItem[];
};
