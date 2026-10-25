/**
 * Additional API typings that are not yet generated from the OpenAPI schema.
 * These mirror the backend stored food ("cooked batches") models so the
 * frontend can share a single source of truth for the fridge inventory types.
 */

export interface StoredFoodBase {
  label?: string | null;
  food_id?: number | null;
  ingredient_id?: number | null;
  prepared_portions: number;
  per_portion_calories: number | null;
  per_portion_protein: number | null;
  per_portion_carbohydrates: number | null;
  per_portion_fat: number | null;
  per_portion_fiber: number | null;
}

export interface StoredFoodCreate extends StoredFoodBase {
  remaining_portions?: number | null;
  prepared_at?: string | null;
}

export interface StoredFoodRead extends StoredFoodBase {
  id: number;
  user_id: string;
  remaining_portions: number;
  is_finished: boolean;
  prepared_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface StoredFoodConsume {
  portions: number;
}

export type CookedBatchBase = StoredFoodBase;
export type CookedBatchCreate = StoredFoodCreate;
export type CookedBatch = StoredFoodRead;
export type CookedBatchConsume = StoredFoodConsume;

export type { StoredFoodCreate as StoredFoodCreatePayload };
