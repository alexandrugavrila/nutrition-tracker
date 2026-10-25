import { useAccountFetch } from "@/contexts/AccountScope";
import { useCallback, useState } from "react";

import { useData } from "@/contexts/DataContext";
import { useSessionStorageReducer } from "@/hooks/useSessionStorageState";
import { roundNutritionValue } from "@/utils/nutritionPrecision";
import { generateUUID } from "@/utils/utils";
import type { components, operations } from "@/api-types";

import type { UsdaNormalizationDataType } from "./usdaDataTypes";

type IngredientRead = components["schemas"]["IngredientRead"];
type IngredientUnitUpdate = components["schemas"]["IngredientUnitUpdate"];
type IngredientUnitCreate = components["schemas"]["IngredientUnitCreate"];
type IngredientShoppingUnitSelection = components["schemas"]["IngredientShoppingUnitSelection"];
type IngredientRequest = operations["add_ingredient_api_ingredients__post"]["requestBody"]["content"]["application/json"];

export type IngredientSource = "manual" | "usda";

export type UsdaIngredientUnit = {
  id?: string | number | null;
  name: string;
  grams: number;
  is_default?: boolean;
};

export type UsdaIngredientResult = {
  id: string;
  name: string;
  nutrition: {
    calories: number | null;
    protein: number | null;
    carbohydrates: number | null;
    fat: number | null;
    fiber: number | null;
  } | null;
  normalization: {
    source_basis: string;
    normalized_basis: string | null;
    can_normalize: boolean;
    reason: string | null;
    data_type: UsdaNormalizationDataType | null;
    serving_size: number | null;
    serving_size_unit: string | null;
    household_serving_full_text: string | null;
  };
  units: UsdaIngredientUnit[];
  defaultUnitKey: string | null;
};

type IngredientFormIngredient = IngredientRead & {
  shoppingUnitId?: number | string | null;
  source?: IngredientSource;
  source_id?: string | null;
  sourceName?: string | null;
};

type IngredientFormState = {
  ingredient: IngredientFormIngredient;
  needsClearForm: boolean;
  needsFillForm: boolean;
};

type IngredientFormAction =
  | { type: "SET_INGREDIENT"; payload: IngredientFormState["ingredient"] }
  | { type: "SET_CLEAR_FORM"; payload: boolean }
  | { type: "SET_FILL_FORM"; payload: boolean };

type SaveOptions = {
  mode: "add" | "edit";
  onSaved?: () => void;
  autoClearOnAdd?: boolean;
};

type DeleteOptions = {
  onDeleted?: () => void;
};

const initializeEmptyIngredient = (): IngredientFormState["ingredient"] => ({
  name: "",
  id: generateUUID(),
  units: [
    {
      id: "0",
      ingredient_id: generateUUID(),
      name: "g",
      grams: "1",
    } as IngredientUnitCreate & { id: string },
  ],
  nutrition: {
    calories: null,
    protein: null,
    carbohydrates: null,
    fat: null,
    fiber: null,
  },
  tags: [],
  shoppingUnitId: "0",
  source: "manual",
  source_id: null,
  sourceName: null,
});


const createUsdaUnitKey = (unit: Pick<UsdaIngredientUnit, "id" | "name" | "grams">): string => {
  if (unit.id !== null && unit.id !== undefined && String(unit.id).trim() !== "") {
    return `id:${String(unit.id)}`;
  }

  return `name:${unit.name.trim().toLowerCase()}|grams:${Number(unit.grams)}`;
};

const normalizeUsdaUnits = (units: UsdaIngredientUnit[] | null | undefined): UsdaIngredientUnit[] => {
  if (!Array.isArray(units)) {
    return [];
  }

  const seen = new Set<string>();

  return units.reduce<UsdaIngredientUnit[]>((acc, unit) => {
    const name = typeof unit.name === "string" ? unit.name.trim() : "";
    const grams = Number(unit.grams);

    if (!name || !Number.isFinite(grams) || grams <= 0) {
      return acc;
    }

    const normalizedUnit: UsdaIngredientUnit = {
      id: unit.id ?? null,
      name,
      grams,
      is_default: Boolean(unit.is_default),
    };
    const key = createUsdaUnitKey(normalizedUnit);
    if (seen.has(key)) {
      return acc;
    }

    seen.add(key);
    acc.push(normalizedUnit);
    return acc;
  }, []);
};

const getDefaultUsdaUnitKey = (units: UsdaIngredientUnit[]): string | null => {
  const defaultUnit = units.find((unit) => unit.is_default) ?? units[0] ?? null;
  return defaultUnit ? createUsdaUnitKey(defaultUnit) : null;
};

const createInitialState = (): IngredientFormState => ({
  ingredient: initializeEmptyIngredient(),
  needsClearForm: false,
  needsFillForm: false,
});

const reducer = (state: IngredientFormState, action: IngredientFormAction): IngredientFormState => {
  switch (action.type) {
    case "SET_INGREDIENT":
      return { ...state, ingredient: action.payload };
    case "SET_CLEAR_FORM":
      return { ...state, needsClearForm: action.payload };
    case "SET_FILL_FORM":
      return { ...state, needsFillForm: action.payload };
    default:
      return state;
  }
};

const sanitizeUnits = (units: IngredientRead["units"]): (IngredientUnitCreate | IngredientUnitUpdate)[] =>
  (units ?? [])
    .filter((unit) => unit.name !== "g")
    .map(({ id, ...rest }) => (typeof id === "number" ? { id, ...rest } : rest));

const buildRequestPayload = (ingredient: IngredientFormState["ingredient"]): IngredientRequest => {
  const payload: IngredientRequest = {
    name: ingredient.name,
    nutrition: ingredient.nutrition,
    tags: ingredient.tags,

    units: sanitizeUnits(ingredient.units),
  } as IngredientRequest;

  const normalizeShoppingUnitId = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 0 ? value : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") return null;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return numeric > 0 ? numeric : null;
      }
    }
    return null;
  };

  const normalizedId = normalizeShoppingUnitId(ingredient.shoppingUnitId);
  if ("shopping_unit_id" in payload) {
    delete (payload as { shopping_unit_id?: number | null }).shopping_unit_id;
  }
  if ("shopping_unit" in payload) {
    delete (payload as { shopping_unit?: IngredientShoppingUnitSelection | null }).shopping_unit;
  }

  if (normalizedId !== null) {
    (payload as { shopping_unit_id?: number | null }).shopping_unit_id = normalizedId;
  } else {
    const match = (ingredient.units ?? []).find((unit) => {
      if (unit.id === ingredient.shoppingUnitId) return true;
      if (
        typeof ingredient.shoppingUnitId === "string" &&
        unit.id !== null &&
        unit.id !== undefined &&
        String(unit.id) === ingredient.shoppingUnitId
      ) {
        return true;
      }
      return false;
    });

    if (ingredient.shoppingUnitId === null) {
      (payload as { shopping_unit_id?: number | null }).shopping_unit_id = null;
    } else if (match) {
      const selection: IngredientShoppingUnitSelection = {
        unit_id:
          typeof match.id === "number" && Number.isFinite(match.id)
            ? match.id
            : undefined,
        name: match.name,
        grams: Number(match.grams),
      };
      (payload as { shopping_unit?: IngredientShoppingUnitSelection }).shopping_unit = selection;
    }
  }

  return payload;
};

export const useIngredientForm = () => {
  const fetch = useAccountFetch();
  const { setIngredientsNeedsRefetch, startRequest, endRequest } = useData();
  const [error, setError] = useState<string | null>(null);
  const [state, dispatch] = useSessionStorageReducer(reducer, createInitialState, "ingredient-form-state-v1");

  const applyIngredientDefaults = useCallback((ingredient: IngredientRead): IngredientFormState["ingredient"] => {
    const maybeIngredient = ingredient as IngredientFormState["ingredient"];
    return {
      ...ingredient,
      source: maybeIngredient.source ?? "manual",
      source_id: maybeIngredient.source_id ?? null,
      sourceName: maybeIngredient.sourceName ?? null,
    };
  }, []);

  const loadIngredient = useCallback(
    (initial?: IngredientRead | null) => {
      if (initial) {
        dispatch({ type: "SET_INGREDIENT", payload: applyIngredientDefaults(initial) });
        dispatch({ type: "SET_FILL_FORM", payload: true });
      } else {
        dispatch({ type: "SET_INGREDIENT", payload: initializeEmptyIngredient() });
      }
    },
    [dispatch, applyIngredientDefaults],
  );

  const clearForm = useCallback(() => {
    dispatch({ type: "SET_INGREDIENT", payload: initializeEmptyIngredient() });
    dispatch({ type: "SET_CLEAR_FORM", payload: true });
  }, [dispatch]);

  const acknowledgeClearFlag = useCallback(() => {
    dispatch({ type: "SET_CLEAR_FORM", payload: false });
  }, [dispatch]);

  const acknowledgeFillFlag = useCallback(() => {
    dispatch({ type: "SET_FILL_FORM", payload: false });
  }, [dispatch]);

  const save = useCallback(
    async ({ mode, onSaved, autoClearOnAdd = true }: SaveOptions) => {
      const payload = buildRequestPayload(state.ingredient);
      const targetId = state.ingredient.id;
      const isEdit = mode === "edit" && typeof targetId === "number";
      const importing = !isEdit && state.ingredient.source === "usda";
      const url = importing ? `/api/usda/import/${state.ingredient.source_id}` : isEdit ? `/api/ingredients/${targetId}` : "/api/ingredients/";
      const method = isEdit ? "PUT" : "POST";

      startRequest();
      try {
        setError(null);
        const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(importing ? {} : payload) });
        if (!response.ok) {
          const body = await response.json();
          throw new Error(typeof body.detail === "string" ? body.detail : "Unable to save ingredient.");
        }
        setIngredientsNeedsRefetch(true);
        if (mode === "add" && autoClearOnAdd) {
          clearForm();
        }
        onSaved?.();
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unable to save ingredient.");
      } finally {
        endRequest();
      }
    },
    [state.ingredient, startRequest, endRequest, setIngredientsNeedsRefetch, clearForm],
  );

  const remove = useCallback(
    async ({ onDeleted }: DeleteOptions = {}) => {
      const ingredientId = state.ingredient.id;
      if (typeof ingredientId !== "number") return;

      startRequest();
      try {
        setError(null);
        const suffix = state.ingredient.is_shared ? "/selection" : "";
        const response = await fetch(`/api/ingredients/${ingredientId}${suffix}`, { method: "DELETE" });
        if (!response.ok) {
          const body = await response.json();
          setError(typeof body.detail === "string" ? body.detail : "Unable to remove ingredient.");
        } else {
          setIngredientsNeedsRefetch(true);
          onDeleted?.();
        }
      } catch (error) {
        console.error("Error deleting ingredient:", error);
      } finally {
        endRequest();
      }
    },
    [state.ingredient.id, state.ingredient.is_shared, startRequest, endRequest, setIngredientsNeedsRefetch],
  );

  const copyForEditing = useCallback(async () => {
    setError(null);
    startRequest();
    try {
      const response = await fetch(`/api/ingredients/${state.ingredient.id}/copy`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Unable to copy ingredient.");
      loadIngredient(body);
      setIngredientsNeedsRefetch(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to copy ingredient.");
    } finally { endRequest(); }
  }, [state.ingredient.id, startRequest, endRequest, loadIngredient, setIngredientsNeedsRefetch]);

  const applyUsdaResult = useCallback(
    (result: UsdaIngredientResult) => {
      if (!result.normalization.can_normalize || !result.nutrition) {
        return;
      }

      const updatedNutrition = {
        calories: roundNutritionValue(result.nutrition.calories),
        protein: roundNutritionValue(result.nutrition.protein),
        carbohydrates: roundNutritionValue(result.nutrition.carbohydrates),
        fat: roundNutritionValue(result.nutrition.fat),
        fiber: roundNutritionValue(result.nutrition.fiber),
      };

      const normalizedUsdaUnits = normalizeUsdaUnits(result.units);
      const importedUnits = [
        {
          id: "0",
          ingredient_id: state.ingredient.id,
          name: "g",
          grams: 1,
        },
        ...normalizedUsdaUnits
          .filter((unit) => !(unit.name.toLowerCase() === "1 g" && Number(unit.grams) === 1))
          .map((unit) => ({
            id: createUsdaUnitKey(unit),
            ingredient_id: state.ingredient.id,
            name: unit.name,
            grams: unit.grams,
          })),
      ];

      const normalizedDefaultUnitKey = result.defaultUnitKey ?? getDefaultUsdaUnitKey(normalizedUsdaUnits);
      const defaultImportedUnit =
        importedUnits.find((unit) => String(unit.id) === normalizedDefaultUnitKey) ??
        importedUnits.find((unit) => unit.name === "g" && Number(unit.grams) === 1) ??
        importedUnits[0] ??
        null;

      dispatch({
        type: "SET_INGREDIENT",
        payload: {
          ...state.ingredient,
          name: result.name,
          units: importedUnits,
          shoppingUnitId: defaultImportedUnit?.id ?? null,
          nutrition: updatedNutrition,
          source: "usda",
          source_id: result.id,
          sourceName: result.name,
        },
      });
    },
    [dispatch, state.ingredient],
  );

  return {
    ingredient: state.ingredient,
    error,
    copyForEditing,
    needsClearForm: state.needsClearForm,
    needsFillForm: state.needsFillForm,
    dispatch,
    loadIngredient,
    clearForm,
    acknowledgeClearFlag,
    acknowledgeFillFlag,
    save,
    remove,
    applyUsdaResult,
  };
};
