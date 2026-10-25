import { parseNutrient } from "@/utils/nutrition";
// DataContext.tsx
import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  ReactNode,
} from "react";
import { useAccountClient } from "@/contexts/AccountScope";
import type { components } from "../api-types";
import type { CookedBatch } from "../api-extra-types";

type Ingredient = components["schemas"]["IngredientRead"];
type PossibleIngredientTag = components["schemas"]["PossibleIngredientTag"];
type Food = components["schemas"]["FoodRead"];
type PossibleFoodTag = components["schemas"]["PossibleFoodTag"];
type IngredientWithSelection = Ingredient & {
  shoppingUnitId: number | string | null;
};

interface DataContextValue {
  ingredients: IngredientWithSelection[];
  setIngredients: React.Dispatch<
    React.SetStateAction<IngredientWithSelection[]>
  >;
  fridgeInventory: CookedBatch[];
  setFridgeInventory: React.Dispatch<React.SetStateAction<CookedBatch[]>>;
  ingredientProcessingTags: PossibleIngredientTag[];
  ingredientGroupTags: PossibleIngredientTag[];
  ingredientOtherTags: PossibleIngredientTag[];
  foods: Food[];
  foodDietTags: PossibleFoodTag[];
  foodTypeTags: PossibleFoodTag[];
  foodOtherTags: PossibleFoodTag[];
  setIngredientsNeedsRefetch: React.Dispatch<React.SetStateAction<boolean>>;
  setFoodsNeedsRefetch: React.Dispatch<React.SetStateAction<boolean>>;
  setFridgeNeedsRefetch: React.Dispatch<React.SetStateAction<boolean>>;
  fetching: boolean;
  hydrating: boolean;
  hydrated: boolean;
  startRequest: () => void;
  endRequest: () => void;
  addPossibleIngredientTag: (name: string) => Promise<PossibleIngredientTag | null>;
  addPossibleFoodTag: (name: string) => Promise<PossibleFoodTag | null>;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

export const useData = () => useContext(DataContext!);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const apiClient = useAccountClient();
  const [ingredients, setIngredients] = useState<IngredientWithSelection[]>([]);
  const [ingredientsNeedsRefetch, setIngredientsNeedsRefetch] =
    useState(false);
  const [possibleIngredientTags, setPossibleIngredientTags] = useState<
    PossibleIngredientTag[]
  >([]);
  const [foods, setFoods] = useState<Food[]>([]);
  const [fridgeInventory, setFridgeInventory] = useState<CookedBatch[]>([]);
  const [possibleFoodTags, setPossibleFoodTags] = useState<PossibleFoodTag[]>(
    [],
  );
  const [foodsNeedsRefetch, setFoodsNeedsRefetch] = useState(false);
  const [fridgeNeedsRefetch, setFridgeNeedsRefetch] = useState(false);
  const [activeRequests, setActiveRequests] = useState(0);
  const fetching = activeRequests > 0;
  const [hydrating, setHydrating] = useState(true);
  const hydrated = !hydrating;

  const startRequest = useCallback(() => {
    setActiveRequests((prev) => prev + 1);
  }, []);

  const endRequest = useCallback(() => {
    setActiveRequests((prev) => Math.max(prev - 1, 0));
  }, []);

  const toNumber = useCallback((value: unknown, fallback = 0): number => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }, []);

  const toNullableNumber = useCallback((value: unknown): number | null => {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }, []);

  const toStringOrNull = useCallback((value: unknown): string | null => {
    if (value === null || value === undefined) {
      return null;
    }
    return String(value);
  }, []);

  const toStringWithFallback = useCallback(
    (value: unknown, fallback = ""): string => {
      if (value === null || value === undefined) {
        return fallback;
      }
      return String(value);
    },
    [],
  );

  const toBoolean = useCallback((value: unknown): boolean => {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return normalized === "true" || normalized === "1";
    }
    return false;
  }, []);

  const ingredientProcessingTagNames = [
    "Whole Food",
    "Lightly Processed",
    "Highly Processed",
  ];
  const ingredientGroupTagNames = [
    "Vegetable",
    "Fruit",
    "Meat",
    "Dairy",
    "Grain",
  ];

  const ingredientProcessingTags = possibleIngredientTags
    ? possibleIngredientTags.filter(({ name }) =>
        ingredientProcessingTagNames.includes(name),
      )
    : [];
  const ingredientGroupTags = possibleIngredientTags
    ? possibleIngredientTags.filter(({ name }) =>
        ingredientGroupTagNames.includes(name),
      )
    : [];
  const ingredientOtherTags = possibleIngredientTags
    ? possibleIngredientTags.filter(
        ({ name }) =>
          !ingredientProcessingTagNames.includes(name) &&
          !ingredientGroupTagNames.includes(name),
      )
    : [];

  const foodDietTagNames = ["Vegetarian", "Vegan", "Carnivore"];
  const foodTypeTagNames = ["Breakfast", "Lunch", "Dinner", "Snack"];

  const foodDietTags = possibleFoodTags
    ? possibleFoodTags.filter(({ name }) => foodDietTagNames.includes(name))
    : [];
  const foodTypeTags = possibleFoodTags
    ? possibleFoodTags.filter(({ name }) => foodTypeTagNames.includes(name))
    : [];
  const foodOtherTags = possibleFoodTags
    ? possibleFoodTags.filter(
        ({ name }) =>
          !foodDietTagNames.includes(name) && !foodTypeTagNames.includes(name),
      )
    : [];

  const fetchIngredients = useCallback(async () => {
    startRequest();
    try {
      const { data } = await apiClient
        .path("/api/ingredients/")
        .method("get")
        .create()({});
      const normalizeUnitId = (value: unknown): number | string | null => {
        if (value === null || value === undefined) return null;
        if (typeof value === "string" && value.trim() === "") return null;
        if (typeof value === "string") {
          const numeric = Number(value);
          return Number.isFinite(numeric) ? numeric : value;
        }
        if (typeof value === "number" && Number.isFinite(value)) return value;
        return null;
      };

      const processed = data.map((ingredient) => {
        const unitsWithFloatGrams =
          ingredient.units?.map((unit) => {
            const normalizedId =
              unit.id === undefined || unit.id === null ? null : Number(unit.id);
            return {
              ...unit,
              id: normalizedId,
              grams: parseFloat(String(unit.grams)),
            };
          }) ?? [];
        const resolvedShoppingUnitId = normalizeUnitId(
          (ingredient as Ingredient & { shopping_unit_id?: unknown }).shopping_unit_id ??
            (ingredient as Ingredient & { shopping_unit?: { id?: unknown } }).shopping_unit?.id ??
            null,
        );
        const defaultUnit =
          unitsWithFloatGrams.find((unit) => unit.name === "g" && unit.grams === 1) ||
          unitsWithFloatGrams.find((unit) => unit.grams === 1) ||
          unitsWithFloatGrams[0];
        const fallbackUnitId =
          defaultUnit && defaultUnit.id !== undefined && defaultUnit.id !== null
            ? defaultUnit.id
            : null;
        const shoppingUnitId =
          resolvedShoppingUnitId !== null ? resolvedShoppingUnitId : fallbackUnitId;
        return {
          ...ingredient,
          units: unitsWithFloatGrams,
          shoppingUnitId,
        };
      });
      setIngredients(processed);
    } catch (error) {
      console.error("Error fetching data:", error);
      setIngredientsNeedsRefetch(true);
    } finally {
      endRequest();
    }
  }, [startRequest, endRequest]);

  const fetchPossibleIngredientTags = useCallback(async () => {
    startRequest();
    try {
      const { data } = await apiClient
        .path("/api/ingredients/possible_tags")
        .method("get")
        .create()({});
      setPossibleIngredientTags(data);
    } catch (error) {
      console.error("Error fetching tags", error);
    } finally {
      endRequest();
    }
  }, [startRequest, endRequest]);

  const addPossibleIngredientTag = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const existing = possibleIngredientTags.find(
        (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) return existing;
      startRequest();
      try {
        const { data } = (await apiClient
          .path("/api/ingredients/possible_tags")
          .method("post")
          .create()({ body: { name: trimmed } })) as {
          data: PossibleIngredientTag;
        };
        setPossibleIngredientTags((prev) =>
          prev.some((t) => t.id === data.id) ? prev : [...prev, data],
        );
        return data;
      } catch (error) {
        console.error("Error adding ingredient tag:", error);
        return null;
      } finally {
        endRequest();
      }
    },
    [possibleIngredientTags, startRequest, endRequest],
  );

  const addPossibleFoodTag = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const existing = possibleFoodTags.find(
        (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) return existing;
      startRequest();
      try {
        const { data } = (await apiClient
          .path("/api/foods/possible_tags")
          .method("post")
          .create()({ body: { name: trimmed } })) as {
          data: PossibleFoodTag;
        };
        setPossibleFoodTags((prev) =>
          prev.some((t) => t.id === data.id) ? prev : [...prev, data],
        );
        return data;
      } catch (error) {
        console.error("Error adding food tag:", error);
        return null;
      } finally {
        endRequest();
      }
    },
    [possibleFoodTags, startRequest, endRequest],
  );

  const fetchFoods = useCallback(async () => {
    startRequest();
    try {
      const { data } = await apiClient
        .path("/api/foods/")
        .method("get")
        .create()({});
      const processed = data.map((food) => ({
        ...food,
        ingredients:
          food.ingredients?.map((mi) => ({
            ...mi,
            unit_quantity: mi.unit_quantity
              ? parseFloat(String(mi.unit_quantity))
              : 0,
          })) ?? [],
      }));
      setFoods(processed);
    } catch (error) {
      console.error("Error fetching data:", error);
      setFoodsNeedsRefetch(true);
    } finally {
      endRequest();
    }
  }, [startRequest, endRequest]);

  const fetchFridgeInventory = useCallback(async () => {
    startRequest();
    try {
      const { data } = await apiClient
        .path("/api/stored_food/")
        .method("get")
        .create()({});
      const items = Array.isArray(data) ? data : [];
      const processed = items.map((entry) => {
        const record = entry as Record<string, unknown>;
        return {
          id: toNumber(record.id),
          label: toStringOrNull(record.label),
          user_id: toStringWithFallback(record.user_id),
          food_id: toNullableNumber(record.food_id),
          ingredient_id: toNullableNumber(record.ingredient_id),
          prepared_portions: toNumber(record.prepared_portions),
          remaining_portions: toNumber(record.remaining_portions),
          per_portion_calories: parseNutrient(record.per_portion_calories),
          per_portion_protein: parseNutrient(record.per_portion_protein),
          per_portion_carbohydrates: parseNutrient(record.per_portion_carbohydrates),
          per_portion_fat: parseNutrient(record.per_portion_fat),
          per_portion_fiber: parseNutrient(record.per_portion_fiber),
          is_finished: toBoolean(record.is_finished),
          prepared_at: toStringWithFallback(record.prepared_at),
          updated_at: toStringWithFallback(record.updated_at),
          completed_at:
            record.completed_at === null || record.completed_at === undefined
              ? null
              : toStringWithFallback(record.completed_at),
        } satisfies CookedBatch;
      });
      setFridgeInventory(processed);
    } catch (error) {
      console.error("Error fetching fridge inventory:", error);
      setFridgeNeedsRefetch(true);
    } finally {
      endRequest();
    }
  }, [
    endRequest,
    setFridgeInventory,
    setFridgeNeedsRefetch,
    startRequest,
    toBoolean,
    toNullableNumber,
    toNumber,
    toStringOrNull,
    toStringWithFallback,
  ]);

  const fetchPossibleFoodTags = useCallback(async () => {
    startRequest();
    try {
      const { data } = await apiClient
        .path("/api/foods/possible_tags")
        .method("get")
        .create()({});
      setPossibleFoodTags(data);
    } catch (error) {
      console.error("Error fetching tags", error);
    } finally {
      endRequest();
    }
  }, [startRequest, endRequest]);

  //#region Effects
  useEffect(() => {
    let isMounted = true;
    const hydrate = async () => {
      const ingredientsPromise = fetchIngredients();
      const foodsPromise = fetchFoods();
      const fridgePromise = fetchFridgeInventory();
      fetchPossibleIngredientTags();
      fetchPossibleFoodTags();
      await Promise.allSettled([
        ingredientsPromise,
        foodsPromise,
        fridgePromise,
      ]);
      if (isMounted) {
        setHydrating(false);
      }
    };
    hydrate();
    return () => {
      isMounted = false;
    };
  }, [
    fetchIngredients,
    fetchPossibleIngredientTags,
    fetchFoods,
    fetchPossibleFoodTags,
    fetchFridgeInventory,
  ]); // Initial fetch

  useEffect(() => {
    if (ingredientsNeedsRefetch) {
      fetchIngredients();
      setIngredientsNeedsRefetch(false);
    }
    if (foodsNeedsRefetch) {
      fetchFoods();
      setFoodsNeedsRefetch(false);
    }
    if (fridgeNeedsRefetch) {
      fetchFridgeInventory();
      setFridgeNeedsRefetch(false);
    }
  }, [
    ingredientsNeedsRefetch,
    foodsNeedsRefetch,
    fetchIngredients,
    fetchFoods,
    fridgeNeedsRefetch,
    fetchFridgeInventory,
    setFridgeNeedsRefetch,
  ]); // Handle needsRefetch
  //#endregion Effects

  const value = {
    ingredients,
    setIngredients,
    fridgeInventory,
    setFridgeInventory,
    ingredientProcessingTags,
    ingredientGroupTags,
    ingredientOtherTags,
    foods,
    foodDietTags,
    foodTypeTags,
    foodOtherTags,
    setIngredientsNeedsRefetch,
    setFoodsNeedsRefetch,
    setFridgeNeedsRefetch,
    fetching,
    hydrating,
    hydrated,
    startRequest,
    endRequest,
    addPossibleIngredientTag,
    addPossibleFoodTag,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

