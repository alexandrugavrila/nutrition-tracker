import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";

import { useAccountClient } from "@/contexts/AccountScope";
import type { StoredFoodCreate } from "@/api-extra-types";
import FeedbackSnackbar, {
  SnackbarMessage,
} from "@/components/common/FeedbackSnackbar";
import IngredientModal from "@/components/common/IngredientModal";
import DecimalInput from "@/components/common/DecimalInput";
import IngredientTable from "@/components/data/ingredient/IngredientTable";
import { useData } from "@/contexts/DataContext";
import { useSessionStorageState } from "@/hooks/useSessionStorageState";
import type {
  FoodPlanItem,
  IngredientPlanItem,
  PlanItem,
} from "@/utils/planningTypes";
import {
  scaleNutrient,
  UNKNOWN_MACROS,
  ZERO_MACROS,
  addMacroTotals,
  createIngredientLookup,
  findIngredientInLookup,
  gramsForIngredientPortion,
  macrosForIngredientPortion,
} from "@/utils/nutrition";
import type { FoodRead, IngredientRead, MacroTotals } from "@/utils/nutrition";
import { formatCellNumber } from "@/utils/utils";

const GRAM_UNIT_SENTINEL = 0;

const DISPLAY_DECIMAL_PLACES = 3;

const roundDisplayValue = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** DISPLAY_DECIMAL_PLACES;
  const rounded = Math.round(value * factor) / factor;
  return Math.abs(rounded) < 1e-9 ? 0 : rounded;
};

const normalizePlanUnitId = (value: unknown): number => {
  if (value === null || value === undefined || value === "") {
    return GRAM_UNIT_SENTINEL;
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
  return GRAM_UNIT_SENTINEL;
};

const toFiniteNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clampNonNegative = (value: number): number => (value < 0 ? 0 : value);

const divideMacroTotals = (totals: MacroTotals, divisor: number): MacroTotals => {
  if (!Number.isFinite(divisor) || divisor <= 0) {
    return { ...ZERO_MACROS };
  }

  return {
    calories: scaleNutrient(totals.calories, 1 / divisor),
    protein: scaleNutrient(totals.protein, 1 / divisor),
    carbs: scaleNutrient(totals.carbs, 1 / divisor),
    fat: scaleNutrient(totals.fat, 1 / divisor),
    fiber: scaleNutrient(totals.fiber, 1 / divisor),
  };
};

const planItemKey = (item: PlanItem, index: number): string => {
  if (item.type === "food") {
    return `food:${index}:${String(item.foodId ?? "")}`;
  }
  return `ingredient:${index}:${String(item.ingredientId ?? "")}`;
};

const foodIngredientKey = (
  planIndex: number,
  ingredientId: unknown,
): string => `foodIngredient:${planIndex}:${String(ingredientId ?? "")}`;

const addedFoodIngredientKey = (
  planIndex: number,
  ingredientId: unknown,
): string => `foodIngredientAdded:${planIndex}:${String(ingredientId ?? "")}`;

type CookingActualState = {
  portions: Record<string, number>;
  ingredientTotals: Record<string, IngredientMeasurement>;
  foodAdjustments: Record<string, FoodIngredientAdjustments>;
};

type ActivePlanState = {
  id: number | null;
  label: string | null;
  updatedAt: string | null;
};

type IngredientMeasurement = {
  quantity: number;
  unitId: number;
};

type FoodIngredientAdjustments = {
  removedIngredientIds: string[];
  addedIngredientIds: string[];
};

const initialActualState: CookingActualState = {
  portions: {},
  ingredientTotals: {},
  foodAdjustments: {},
};

const measurementsEqual = (
  a: IngredientMeasurement,
  b: IngredientMeasurement,
): boolean => Object.is(a.quantity, b.quantity) && Object.is(a.unitId, b.unitId);

const normalizeMeasurement = (
  value: unknown,
  fallbackQuantity: number,
  fallbackUnitId: number,
): IngredientMeasurement => {
  const normalizedFallbackUnit = normalizePlanUnitId(fallbackUnitId);
  const normalizedFallbackQuantity = roundDisplayValue(
    clampNonNegative(fallbackQuantity),
  );

  if (value && typeof value === "object") {
    const record = value as { quantity?: unknown; unitId?: unknown };
    const quantity = roundDisplayValue(
      clampNonNegative(toFiniteNumber(record.quantity)),
    );
    const unitId = normalizePlanUnitId(
      record.unitId !== undefined ? record.unitId : normalizedFallbackUnit,
    );
    return { quantity, unitId };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return {
      quantity: roundDisplayValue(clampNonNegative(value)),
      unitId: normalizedFallbackUnit,
    };
  }

  return {
    quantity: normalizedFallbackQuantity,
    unitId: normalizedFallbackUnit,
  };
};

const readMeasurementWithFallback = (
  totals: CookingActualState["ingredientTotals"],
  key: string,
  fallbackQuantity: number,
  fallbackUnitId: number,
): IngredientMeasurement =>
  normalizeMeasurement(totals[key], fallbackQuantity, fallbackUnitId);

const resolveIngredientUnitName = (
  ingredient: FoodRead | IngredientRead | undefined,
  unitId: number,
): string => {
  if (!ingredient) {
    return unitId === GRAM_UNIT_SENTINEL ? "g" : "";
  }

  const candidateUnits = (ingredient as IngredientRead).units ?? [];
  const match = candidateUnits.find(
    (unit) => normalizePlanUnitId(unit?.id) === unitId,
  );
  if (match?.name && match.name.trim() !== "") {
    return match.name;
  }

  return unitId === GRAM_UNIT_SENTINEL ? "g" : "";
};

const shallowEqualNumberRecords = (
  a: Record<string, number>,
  b: Record<string, number>,
): boolean => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
};

const shallowEqualMeasurementRecords = (
  a: Record<string, IngredientMeasurement>,
  b: Record<string, IngredientMeasurement>,
): boolean => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    const valueA = a[key];
    const valueB = b[key];
    if (!valueB || !measurementsEqual(valueA, valueB)) {
      return false;
    }
  }
  return true;
};

const arrayValuesEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const shallowEqualFoodAdjustments = (
  a: Record<string, FoodIngredientAdjustments> | undefined,
  b: Record<string, FoodIngredientAdjustments> | undefined,
): boolean => {
  const normalizedA = a ?? {};
  const normalizedB = b ?? {};
  const aKeys = Object.keys(normalizedA);
  const bKeys = Object.keys(normalizedB);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    const valueA = normalizedA[key];
    const valueB = normalizedB[key];
    if (!valueB) {
      return false;
    }
    if (
      !arrayValuesEqual(valueA.removedIngredientIds, valueB.removedIngredientIds) ||
      !arrayValuesEqual(valueA.addedIngredientIds, valueB.addedIngredientIds)
    ) {
      return false;
    }
  }
  return true;
};

const cookingStatesEqual = (
  a: CookingActualState,
  b: CookingActualState,
): boolean =>
  shallowEqualNumberRecords(a.portions, b.portions) &&
  shallowEqualMeasurementRecords(a.ingredientTotals, b.ingredientTotals) &&
  shallowEqualFoodAdjustments(a.foodAdjustments, b.foodAdjustments);

const normalizeIngredientId = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
};

const normalizeIngredientIdList = (
  values: unknown,
  validIds?: Set<string>,
): string[] => {
  if (!Array.isArray(values)) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const normalized = normalizeIngredientId(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    if (validIds && !validIds.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

const buildFoodAdjustments = (
  prev: CookingActualState["foodAdjustments"] | undefined,
  planKey: string,
  baseIngredientIds: Set<string>,
  ingredientIdSet: Set<string>,
): FoodIngredientAdjustments => {
  const previous = prev[planKey];
  const removedIngredientIds = normalizeIngredientIdList(
    previous?.removedIngredientIds,
    baseIngredientIds,
  );
  const addedIngredientIds = normalizeIngredientIdList(
    previous?.addedIngredientIds,
    ingredientIdSet,
  );

  return { removedIngredientIds, addedIngredientIds };
};

const resolveDefaultIngredientUnitId = (
  ingredient: IngredientRead | undefined,
): number =>
  normalizePlanUnitId(ingredient?.units?.[0]?.id ?? GRAM_UNIT_SENTINEL);

const pluralize = (value: number, noun: string): string => {
  const rounded = Math.abs(value - 1) < 1e-6 ? 1 : value;
  if (Math.abs(rounded - 1) < 1e-6) {
    return `${formatCellNumber(value)} ${noun}`;
  }
  return `${formatCellNumber(value)} ${noun}s`;
};

function Cooking() {
  const apiClient = useAccountClient();
  const { foods, ingredients, setFridgeNeedsRefetch } = useData();
  const foodLookup = useMemo(() => {
    const map = new Map<string, FoodRead>();
    foods.forEach((food) => {
      const id = food?.id;
      if (id === null || id === undefined) return;
      map.set(String(id), food);
    });
    return map;
  }, [foods]);
  const ingredientLookup = useMemo(
    () => createIngredientLookup(ingredients),
    [ingredients],
  );
  const ingredientIdSet = useMemo(() => {
    const set = new Set<string>();
    ingredients.forEach((ingredient) => {
      const id = normalizeIngredientId(ingredient?.id);
      if (id) {
        set.add(id);
      }
    });
    return set;
  }, [ingredients]);

  const [plan] = useSessionStorageState<PlanItem[]>("planning-plan", () => []);
  const [days] = useSessionStorageState<number>("planning-days", 1);
  const [activePlan] = useSessionStorageState<ActivePlanState>(
    "planning-active-plan",
    () => ({ id: null, label: null, updatedAt: null }),
  );

  const [actualState, setActualState] =
    useSessionStorageState<CookingActualState>(
      "cooking-actuals",
      () => ({ ...initialActualState }),
    );
  const [completedPlanKeyList, setCompletedPlanKeyList] =
    useSessionStorageState<string[]>("cooking-completed-plan-keys", () => []);
  const completedPlanKeys = useMemo(
    () => new Set(completedPlanKeyList),
    [completedPlanKeyList],
  );
  const [pendingCompletionKeys, setPendingCompletionKeys] =
    useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<SnackbarMessage | null>(null);
  const [ingredientModalOpen, setIngredientModalOpen] = useState(false);
  const [ingredientPickerOpen, setIngredientPickerOpen] = useState(false);
  const [ingredientPickerPlanKey, setIngredientPickerPlanKey] = useState<
    string | null
  >(null);
  const handleFeedbackClose = useCallback(() => {
    setFeedback(null);
  }, []);

  useEffect(() => {
    setCompletedPlanKeyList((prev) => {
      const planKeys = new Set<string>();
      plan.forEach((item, index) => {
        planKeys.add(planItemKey(item, index));
      });
      const filtered = prev.filter((key) => planKeys.has(key));
      if (filtered.length === prev.length) {
        return prev;
      }
      return filtered;
    });
    setPendingCompletionKeys((prev) => {
      const next = new Set<string>();
      plan.forEach((item, index) => {
        const key = planItemKey(item, index);
        if (prev.has(key)) {
          next.add(key);
        }
      });
      return next;
    });
  }, [plan, setCompletedPlanKeyList]);

  const activePlanEntries = useMemo(
    () =>
      plan
        .map((item, index) => ({ item, index, key: planItemKey(item, index) }))
        .filter(({ key }) => !completedPlanKeys.has(key)),
    [plan, completedPlanKeys],
  );

  const sanitizeActualState = useCallback(
    (prev: CookingActualState): CookingActualState => {
      const nextPortions: Record<string, number> = {};
      const nextIngredientTotals: Record<string, IngredientMeasurement> = {};
      const nextFoodAdjustments: Record<string, FoodIngredientAdjustments> = {};

      plan.forEach((item, index) => {
        const itemKey = planItemKey(item, index);
        if (item.type === "food") {
          const plannedPortions = roundDisplayValue(
            clampNonNegative(toFiniteNumber(item.portions)),
          );
          const storedPortion = prev.portions[itemKey];
          const normalizedPortion = roundDisplayValue(
            isFiniteNumber(storedPortion)
              ? clampNonNegative(storedPortion)
              : plannedPortions,
          );
          nextPortions[itemKey] = normalizedPortion;

          const food = foodLookup.get(String(item.foodId ?? ""));
          const baseIngredientIds = new Set<string>(
            (food?.ingredients ?? [])
              .map((ingredient) => normalizeIngredientId(ingredient.ingredient_id))
              .filter((id): id is string => Boolean(id)),
          );
          const foodAdjustments = buildFoodAdjustments(
            prev.foodAdjustments ?? {},
            itemKey,
            baseIngredientIds,
            ingredientIdSet,
          );
          nextFoodAdjustments[itemKey] = foodAdjustments;
          if (food && Array.isArray(food.ingredients)) {
            food.ingredients.forEach((ingredient) => {
              const override = item.overrides[String(ingredient.ingredient_id)];
              const perPortionQuantity = roundDisplayValue(
                clampNonNegative(
                  toFiniteNumber(override?.quantity ?? ingredient.unit_quantity),
                ),
              );
              const key = foodIngredientKey(index, ingredient.ingredient_id);
              const defaultTotal = perPortionQuantity * normalizedPortion;
              const defaultUnitId = normalizePlanUnitId(
                override?.unitId ?? ingredient.unit_id,
              );
              nextIngredientTotals[key] = normalizeMeasurement(
                prev.ingredientTotals[key],
                defaultTotal,
                defaultUnitId,
              );
            });
          }
          foodAdjustments.addedIngredientIds.forEach((ingredientId) => {
            const dataIngredient = findIngredientInLookup(
              ingredientLookup,
              ingredientId,
            );
            const addedKey = addedFoodIngredientKey(index, ingredientId);
            const defaultUnitId = resolveDefaultIngredientUnitId(dataIngredient);
            nextIngredientTotals[addedKey] = normalizeMeasurement(
              prev.ingredientTotals[addedKey],
              0,
              defaultUnitId,
            );
          });
        } else {
          const amountPerPortion = roundDisplayValue(
            clampNonNegative(toFiniteNumber(item.amount)),
          );
          const plannedPortions = roundDisplayValue(
            clampNonNegative(toFiniteNumber((item as IngredientPlanItem).portions ?? 1)),
          );
          const defaultTotal =
            amountPerPortion * (plannedPortions > 0 ? plannedPortions : 1);
          const defaultUnitId = normalizePlanUnitId(item.unitId);
          nextIngredientTotals[itemKey] = normalizeMeasurement(
            prev.ingredientTotals[itemKey],
            defaultTotal,
            defaultUnitId,
          );
        }
      });

      return {
        portions: nextPortions,
        ingredientTotals: nextIngredientTotals,
        foodAdjustments: nextFoodAdjustments,
      };
    },
    [plan, foodLookup, ingredientIdSet, ingredientLookup],
  );

  useEffect(() => {
    setActualState((prev) => {
      const sanitized = sanitizeActualState(prev);
      if (cookingStatesEqual(prev, sanitized)) {
        return prev;
      }
      return sanitized;
    });
  }, [sanitizeActualState, setActualState]);

  const updateFoodPortion = useCallback(
    (item: FoodPlanItem, index: number, value: number) => {
      const key = planItemKey(item, index);
      const sanitizedValue = roundDisplayValue(clampNonNegative(value));
      setActualState((prev) => {
        const previousValue = roundDisplayValue(
          isFiniteNumber(prev.portions[key])
            ? clampNonNegative(prev.portions[key])
            : clampNonNegative(toFiniteNumber(item.portions)),
        );
        if (Object.is(previousValue, sanitizedValue)) {
          return prev;
        }

        const nextPortions = { ...prev.portions, [key]: sanitizedValue };

        return {
          portions: nextPortions,
          ingredientTotals: prev.ingredientTotals,
          foodAdjustments: prev.foodAdjustments ?? {},
        };
      });
    },
    [setActualState],
  );

  const updateIngredientMeasurement = useCallback(
    (
      key: string,
      fallback: IngredientMeasurement,
      updates: Partial<IngredientMeasurement>,
    ) => {
      setActualState((prev) => {
        const current = normalizeMeasurement(
          prev.ingredientTotals[key],
          fallback.quantity,
          fallback.unitId,
        );
        const nextMeasurement: IngredientMeasurement = {
          quantity: roundDisplayValue(
            updates.quantity !== undefined
              ? clampNonNegative(updates.quantity)
              : current.quantity,
          ),
          unitId:
            updates.unitId !== undefined
              ? normalizePlanUnitId(updates.unitId)
              : current.unitId,
        };
        if (measurementsEqual(current, nextMeasurement)) {
          if (prev.ingredientTotals[key]) {
            return prev;
          }
        }
        return {
          portions: prev.portions,
          ingredientTotals: {
            ...prev.ingredientTotals,
            [key]: nextMeasurement,
          },
          foodAdjustments: prev.foodAdjustments ?? {},
        };
      });
    },
    [setActualState],
  );

  const toggleFoodIngredientRemoved = useCallback(
    (planKey: string, ingredientId: string, shouldRemove: boolean) => {
      setActualState((prev) => {
        const existingAdjustments = prev.foodAdjustments ?? {};
        const current = existingAdjustments[planKey] ?? {
          removedIngredientIds: [],
          addedIngredientIds: [],
        };
        const normalizedId = normalizeIngredientId(ingredientId);
        if (!normalizedId) {
          return prev;
        }
        const removedIngredientIds = shouldRemove
          ? Array.from(new Set([...current.removedIngredientIds, normalizedId]))
          : current.removedIngredientIds.filter((id) => id !== normalizedId);
        if (arrayValuesEqual(removedIngredientIds, current.removedIngredientIds)) {
          return prev;
        }
        return {
          portions: prev.portions,
          ingredientTotals: prev.ingredientTotals,
          foodAdjustments: {
            ...existingAdjustments,
            [planKey]: {
              removedIngredientIds,
              addedIngredientIds: current.addedIngredientIds,
            },
          },
        };
      });
    },
    [setActualState],
  );

  const addFoodIngredient = useCallback(
    (planKey: string, ingredientId: string) => {
      const normalizedId = normalizeIngredientId(ingredientId);
      if (!normalizedId) {
        return;
      }
      setActualState((prev) => {
        const existingAdjustments = prev.foodAdjustments ?? {};
        const current = existingAdjustments[planKey] ?? {
          removedIngredientIds: [],
          addedIngredientIds: [],
        };
        if (current.addedIngredientIds.includes(normalizedId)) {
          return prev;
        }
        return {
          portions: prev.portions,
          ingredientTotals: prev.ingredientTotals,
          foodAdjustments: {
            ...existingAdjustments,
            [planKey]: {
              removedIngredientIds: current.removedIngredientIds,
              addedIngredientIds: [...current.addedIngredientIds, normalizedId],
            },
          },
        };
      });
    },
    [setActualState],
  );

  const removeAddedFoodIngredient = useCallback(
    (planKey: string, ingredientId: string, planIndex: number) => {
      const normalizedId = normalizeIngredientId(ingredientId);
      if (!normalizedId) {
        return;
      }
      setActualState((prev) => {
        const existingAdjustments = prev.foodAdjustments ?? {};
        const current = existingAdjustments[planKey];
        if (!current || !current.addedIngredientIds.includes(normalizedId)) {
          return prev;
        }
        const addedIngredientIds = current.addedIngredientIds.filter(
          (id) => id !== normalizedId,
        );
        const nextTotals = { ...prev.ingredientTotals };
        delete nextTotals[addedFoodIngredientKey(planIndex, normalizedId)];
        return {
          portions: prev.portions,
          ingredientTotals: nextTotals,
          foodAdjustments: {
            ...existingAdjustments,
            [planKey]: {
              removedIngredientIds: current.removedIngredientIds,
              addedIngredientIds,
            },
          },
        };
      });
    },
    [setActualState],
  );

  const handleOpenIngredientModal = useCallback(() => {
    setIngredientModalOpen(true);
  }, []);

  const handleCloseIngredientModal = useCallback(() => {
    setIngredientModalOpen(false);
  }, []);

  const handleOpenIngredientPicker = useCallback((planKey: string) => {
    setIngredientPickerPlanKey(planKey);
    setIngredientPickerOpen(true);
  }, []);

  const handleCloseIngredientPicker = useCallback(() => {
    setIngredientPickerPlanKey(null);
    setIngredientPickerOpen(false);
  }, []);

  const handleAddIngredient = useCallback(
    (ingredient: IngredientRead) => {
      if (
        !ingredientPickerPlanKey ||
        ingredient.id === null ||
        ingredient.id === undefined
      ) {
        return;
      }
      addFoodIngredient(ingredientPickerPlanKey, String(ingredient.id));
      handleCloseIngredientPicker();
    },
    [addFoodIngredient, handleCloseIngredientPicker, ingredientPickerPlanKey],
  );

  const computeFoodActualMacros = useCallback(
    (item: FoodPlanItem, index: number): MacroTotals => {
      const food = foodLookup.get(String(item.foodId ?? ""));
      if (!food || !Array.isArray(food.ingredients)) {
        return { ...UNKNOWN_MACROS };
      }

      const portionKey = planItemKey(item, index);
      const adjustment = actualState.foodAdjustments?.[portionKey];
      const removedIngredientIds = new Set(
        adjustment?.removedIngredientIds ?? [],
      );
      const actualPortions = roundDisplayValue(
        clampNonNegative(
          toFiniteNumber(actualState.portions[portionKey] ?? item.portions),
        ),
      );

      const baseTotals = food.ingredients.reduce((totals, ingredient) => {
        const ingredientId = normalizeIngredientId(ingredient.ingredient_id);
        if (ingredientId && removedIngredientIds.has(ingredientId)) {
          return totals;
        }
        const dataIngredient = findIngredientInLookup(
          ingredientLookup,
          ingredient.ingredient_id,
        );
        if (!dataIngredient) {
          return addMacroTotals(totals, UNKNOWN_MACROS);
        }
        const key = foodIngredientKey(index, ingredient.ingredient_id);
        const override = item.overrides[String(ingredient.ingredient_id)];
        const defaultUnitId = normalizePlanUnitId(
          override?.unitId ?? ingredient.unit_id,
        );
        const quantityPerPortion = roundDisplayValue(
          clampNonNegative(
            toFiniteNumber(override?.quantity ?? ingredient.unit_quantity),
          ),
        );
        const fallbackQuantity = roundDisplayValue(
          quantityPerPortion * actualPortions,
        );
        const measurement = readMeasurementWithFallback(
          actualState.ingredientTotals,
          key,
          fallbackQuantity,
          defaultUnitId,
        );
        const ingredientMacros = macrosForIngredientPortion({
          ingredient: dataIngredient,
          unitId: measurement.unitId,
          quantity: measurement.quantity,
        });
        return addMacroTotals(totals, ingredientMacros);
      }, { ...ZERO_MACROS });

      const addedTotals = (adjustment?.addedIngredientIds ?? []).reduce(
        (totals, ingredientId) => {
          const dataIngredient = findIngredientInLookup(
            ingredientLookup,
            ingredientId,
          );
          if (!dataIngredient) {
            return addMacroTotals(totals, UNKNOWN_MACROS);
          }
          const addedKey = addedFoodIngredientKey(index, ingredientId);
          const defaultUnitId = resolveDefaultIngredientUnitId(dataIngredient);
          const measurement = readMeasurementWithFallback(
            actualState.ingredientTotals,
            addedKey,
            0,
            defaultUnitId,
          );
          const ingredientMacros = macrosForIngredientPortion({
            ingredient: dataIngredient,
            unitId: measurement.unitId,
            quantity: measurement.quantity,
          });
          return addMacroTotals(totals, ingredientMacros);
        },
        { ...ZERO_MACROS },
      );

      return addMacroTotals(baseTotals, addedTotals);
    },
    [
      actualState.ingredientTotals,
      actualState.foodAdjustments,
      actualState.portions,
      foodLookup,
      ingredientLookup,
    ],
  );

  const totalActualMacros = useMemo(
    () =>
      activePlanEntries.reduce((totals, { item, index }) => {
        if (item.type === "food") {
          const foodMacros = computeFoodActualMacros(item, index);
          return addMacroTotals(totals, foodMacros);
        }
        const ingredient = findIngredientInLookup(
          ingredientLookup,
          (item as IngredientPlanItem).ingredientId,
        );
        const key = planItemKey(item, index);
        const ingredientPlan = item as IngredientPlanItem;
        const defaultUnitId = normalizePlanUnitId(ingredientPlan.unitId);
        const amountPerPortion = clampNonNegative(
          toFiniteNumber(ingredientPlan.amount),
        );
        const plannedPortions = clampNonNegative(
          toFiniteNumber(ingredientPlan.portions ?? 1),
        );
        const defaultQuantity =
          amountPerPortion * (plannedPortions > 0 ? plannedPortions : 1);
        const measurement = readMeasurementWithFallback(
          actualState.ingredientTotals,
          key,
          defaultQuantity,
          defaultUnitId,
        );
        const macros = macrosForIngredientPortion({
          ingredient,
          unitId: measurement.unitId,
          quantity: measurement.quantity,
        });
        return addMacroTotals(totals, macros);
      }, { ...ZERO_MACROS }),
    [
      activePlanEntries,
      actualState.ingredientTotals,
      computeFoodActualMacros,
      ingredientLookup,
    ],
  );

  const normalizedDays = Number.isFinite(days) && days > 0 ? days : 1;
  const perDayActualMacros = useMemo<MacroTotals>(
    () => ({
      calories: scaleNutrient(totalActualMacros.calories, 1 / normalizedDays),
      protein: scaleNutrient(totalActualMacros.protein, 1 / normalizedDays),
      carbs: scaleNutrient(totalActualMacros.carbs, 1 / normalizedDays),
      fat: scaleNutrient(totalActualMacros.fat, 1 / normalizedDays),
      fiber: scaleNutrient(totalActualMacros.fiber, 1 / normalizedDays),
    }),
    [normalizedDays, totalActualMacros],
  );

  const planIsEmpty = !plan || plan.length === 0;
  const hasActivePlanItems = activePlanEntries.length > 0;
  const planLabel = activePlan.label?.trim()
    ? `Based on plan "${activePlan.label}"`
    : "Based on current plan";

  const markItemComplete = useCallback(
    async (item: PlanItem, index: number) => {
      const planKey = planItemKey(item, index);
      if (pendingCompletionKeys.has(planKey)) {
        return;
      }
      setFeedback(null);
      setPendingCompletionKeys((prev) => {
        const next = new Set(prev);
        next.add(planKey);
        return next;
      });
      setCompletedPlanKeyList((prev) => {
        if (prev.includes(planKey)) {
          return prev;
        }
        return [...prev, planKey];
      });

      const buildFoodPayload = (foodItem: FoodPlanItem): StoredFoodCreate => {
        const food = foodLookup.get(String(foodItem.foodId ?? ""));
        if (!food) {
          throw new Error("Food details are unavailable.");
        }
        const portionKey = planItemKey(foodItem, index);
        const actualPortions = roundDisplayValue(
          clampNonNegative(
            toFiniteNumber(actualState.portions[portionKey] ?? foodItem.portions),
          ),
        );
        if (actualPortions <= 0) {
          throw new Error("Enter the cooked portions before marking complete.");
        }
        const totalMacros = computeFoodActualMacros(foodItem, index);
        const perPortionMacros = divideMacroTotals(totalMacros, actualPortions);

        const numericFoodId = Number(foodItem.foodId);
        if (!Number.isFinite(numericFoodId)) {
          throw new Error("Unable to determine the food identifier.");
        }

        const payload: StoredFoodCreate = {
          label: food.name ?? null,
          food_id: numericFoodId,
          ingredient_id: null,
          prepared_portions: actualPortions,
          remaining_portions: actualPortions,
          per_portion_calories: (perPortionMacros.calories == null ? null : roundDisplayValue(perPortionMacros.calories)),
          per_portion_protein: (perPortionMacros.protein == null ? null : roundDisplayValue(perPortionMacros.protein)),
          per_portion_carbohydrates: (perPortionMacros.carbs == null ? null : roundDisplayValue(perPortionMacros.carbs)),
          per_portion_fat: (perPortionMacros.fat == null ? null : roundDisplayValue(perPortionMacros.fat)),
          per_portion_fiber: (perPortionMacros.fiber == null ? null : roundDisplayValue(perPortionMacros.fiber)),
        };

        return payload;
      };

      const buildIngredientPayload = (
        ingredientPlan: IngredientPlanItem,
      ): StoredFoodCreate => {
        const ingredient = findIngredientInLookup(
          ingredientLookup,
          ingredientPlan.ingredientId,
        );
        if (!ingredient) {
          throw new Error("Ingredient details are unavailable.");
        }
        const key = planItemKey(ingredientPlan, index);
        const defaultUnitId = normalizePlanUnitId(ingredientPlan.unitId);
        const amountPerPortion = clampNonNegative(
          toFiniteNumber(ingredientPlan.amount),
        );
        const plannedPortions = clampNonNegative(
          toFiniteNumber(ingredientPlan.portions ?? 1),
        );
        const defaultQuantity =
          amountPerPortion * (plannedPortions > 0 ? plannedPortions : 1);
        const measurement = readMeasurementWithFallback(
          actualState.ingredientTotals,
          key,
          defaultQuantity,
          defaultUnitId,
        );
        if (measurement.quantity <= 0) {
          throw new Error("Enter the cooked amount before marking complete.");
        }
        const totalMacros = macrosForIngredientPortion({
          ingredient,
          unitId: measurement.unitId,
          quantity: measurement.quantity,
        });
        const numericIngredientId = Number(ingredientPlan.ingredientId);
        if (!Number.isFinite(numericIngredientId)) {
          throw new Error("Unable to determine the ingredient identifier.");
        }

        const portionSizeGrams = gramsForIngredientPortion({
          ingredient,
          unitId: defaultUnitId,
          quantity: amountPerPortion,
        });
        const totalGrams = gramsForIngredientPortion({
          ingredient,
          unitId: measurement.unitId,
          quantity: measurement.quantity,
        });

        let computedPortions = 1;
        if (portionSizeGrams > 0 && totalGrams > 0) {
          computedPortions = totalGrams / portionSizeGrams;
        } else if (plannedPortions > 0) {
          computedPortions = plannedPortions;
        } else if (measurement.quantity > 0) {
          computedPortions = measurement.quantity;
        }

        const preparedPortions = roundDisplayValue(
          clampNonNegative(toFiniteNumber(computedPortions)),
        );
        const normalizedPortions = preparedPortions > 0 ? preparedPortions : 1;
        const perPortionMacros = divideMacroTotals(
          totalMacros,
          normalizedPortions,
        );

        const unitName = resolveIngredientUnitName(ingredient, measurement.unitId);
        const label = ingredient.name
          ? `${ingredient.name}${
              measurement.quantity
                ? ` (${formatCellNumber(measurement.quantity)}${
                    unitName ? ` ${unitName}` : ""
                  })`
                : ""
            }`
          : null;

        const payload: StoredFoodCreate = {
          label,
          food_id: null,
          ingredient_id: numericIngredientId,
          prepared_portions: normalizedPortions,
          remaining_portions: normalizedPortions,
          per_portion_calories: (perPortionMacros.calories == null ? null : roundDisplayValue(perPortionMacros.calories)),
          per_portion_protein: (perPortionMacros.protein == null ? null : roundDisplayValue(perPortionMacros.protein)),
          per_portion_carbohydrates: (perPortionMacros.carbs == null ? null : roundDisplayValue(perPortionMacros.carbs)),
          per_portion_fat: (perPortionMacros.fat == null ? null : roundDisplayValue(perPortionMacros.fat)),
          per_portion_fiber: (perPortionMacros.fiber == null ? null : roundDisplayValue(perPortionMacros.fiber)),
        };

        return payload;
      };

      try {
        const payload =
          item.type === "food"
            ? buildFoodPayload(item as FoodPlanItem)
            : buildIngredientPayload(item as IngredientPlanItem);

        const displayName =
          payload.label ??
          (item.type === "food"
            ? foodLookup.get(String((item as FoodPlanItem).foodId ?? ""))?.name ??
              "prepared food"
            : findIngredientInLookup(
                ingredientLookup,
                (item as IngredientPlanItem).ingredientId,
              )?.name ?? "prepared ingredient");

        const request = apiClient
          .path("/api/stored_food/")
          .method("post")
          .create();
        await request({ body: payload });
        setFridgeNeedsRefetch(true);

        setFeedback({
          severity: "success",
          message: `Added ${displayName} to the fridge.`,
        });

        setActualState((prev) => {
          const nextPortions = { ...prev.portions };
          const nextTotals = { ...prev.ingredientTotals };
          const nextAdjustments = { ...(prev.foodAdjustments ?? {}) };
          if (item.type === "food") {
            const foodItem = item as FoodPlanItem;
            const portionKey = planItemKey(foodItem, index);
            delete nextPortions[portionKey];
            const food = foodLookup.get(String(foodItem.foodId ?? ""));
            if (food && Array.isArray(food.ingredients)) {
              food.ingredients.forEach((ingredient) => {
                const ingredientKey = foodIngredientKey(
                  index,
                  ingredient.ingredient_id,
                );
                delete nextTotals[ingredientKey];
              });
            }
            const adjustments = nextAdjustments[portionKey];
            if (adjustments) {
              adjustments.addedIngredientIds.forEach((ingredientId) => {
                delete nextTotals[addedFoodIngredientKey(index, ingredientId)];
              });
              delete nextAdjustments[portionKey];
            }
          } else {
            const ingredientKey = planKey;
            delete nextTotals[ingredientKey];
          }
          return {
            portions: nextPortions,
            ingredientTotals: nextTotals,
            foodAdjustments: nextAdjustments,
          };
        });
      } catch (error) {
        setCompletedPlanKeyList((prev) => {
          if (!prev.includes(planKey)) {
            return prev;
          }
          return prev.filter((key) => key !== planKey);
        });
        const fallbackMessage = "Failed to mark item complete.";
        const detail =
          error instanceof Error && error.message
            ? `${fallbackMessage} ${error.message}`.trim()
            : fallbackMessage;
        setFeedback({ severity: "error", message: detail });
      } finally {
        setPendingCompletionKeys((prev) => {
          if (!prev.has(planKey)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(planKey);
          return next;
        });
      }
    },
    [
      actualState.ingredientTotals,
      actualState.portions,
      computeFoodActualMacros,
      foodLookup,
      ingredientLookup,
      pendingCompletionKeys,
      setCompletedPlanKeyList,
      setActualState,
      setFridgeNeedsRefetch,
    ],
  );

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1">
          Cooking
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {planLabel}
        </Typography>
      </Box>

      {planIsEmpty ? (
        <Alert severity="info">
          Build a plan in the Planning tab to capture your actual cooking amounts.
        </Alert>
      ) : (
        <>
          {hasActivePlanItems ? (
            <>
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell>Planned</TableCell>
                      <TableCell>Actual</TableCell>
                      <TableCell>Calories</TableCell>
                      <TableCell>Protein</TableCell>
                      <TableCell>Carbs</TableCell>
                      <TableCell>Fat</TableCell>
                      <TableCell>Fiber</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {activePlanEntries.map(({ item, index, key }) => {
                      if (item.type === "food") {
                        const foodItem = item as FoodPlanItem;
                        const food = foodLookup.get(String(foodItem.foodId ?? ""));
                        const portionKey = planItemKey(foodItem, index);
                        const foodAdjustments =
                          (actualState.foodAdjustments ?? {})[portionKey] ?? {
                            removedIngredientIds: [],
                            addedIngredientIds: [],
                          };
                        const removedIngredientIds = new Set(
                          foodAdjustments.removedIngredientIds,
                        );
                        const actualPortions = roundDisplayValue(
                          clampNonNegative(
                            toFiniteNumber(
                              actualState.portions[portionKey] ??
                                foodItem.portions,
                            ),
                          ),
                        );
                        const foodTotalMacros = computeFoodActualMacros(
                          foodItem,
                          index,
                        );
                        const foodMacros =
                          actualPortions > 0
                            ? divideMacroTotals(foodTotalMacros, actualPortions)
                            : { ...ZERO_MACROS };
                        const plannedPortionsLabel = pluralize(
                          foodItem.portions,
                          "portion",
                        );
                        const completionPending = pendingCompletionKeys.has(key);
                        const foodCompletionDisabled =
                          !food || actualPortions <= 0 || completionPending;

                        return (
                          <React.Fragment key={key}>
                            <TableRow sx={{ backgroundColor: "action.hover" }}>
                              <TableCell sx={{ fontWeight: 600 }}>
                                {food?.name ?? "Unnamed food"}
                              </TableCell>
                              <TableCell>{plannedPortionsLabel}</TableCell>
                              <TableCell>
                                <Box
                                  sx={{ display: "flex", alignItems: "center", gap: 1 }}
                                >
                                  <IconButton
                                    size="small"
                                    aria-label="decrement actual portions"
                                    onClick={() =>
                                      updateFoodPortion(
                                        foodItem,
                                        index,
                                        Math.max(0, actualPortions - 1),
                                      )
                                    }
                                    disabled={actualPortions <= 0}
                                  >
                                    <RemoveIcon fontSize="small" />
                                  </IconButton>
                                  <DecimalInput
                                    value={actualPortions}
                                    onValueChange={(value) =>
                                      updateFoodPortion(
                                        foodItem,
                                        index,
                                        clampNonNegative(value),
                                      )
                                    }
                                    sx={{ width: 100 }}
                                    inputProps={{ min: 0, step: "any" }}
                                  />
                                  <IconButton
                                    size="small"
                                    aria-label="increment actual portions"
                                    onClick={() =>
                                      updateFoodPortion(
                                        foodItem,
                                        index,
                                        actualPortions + 1,
                                      )
                                    }
                                  >
                                    <AddIcon fontSize="small" />
                                  </IconButton>
                                  <Box component="span" sx={{ whiteSpace: "nowrap" }}>
                                    portions
                                  </Box>
                                </Box>
                              </TableCell>
                              <TableCell>
                                {formatCellNumber(foodMacros.calories)}
                              </TableCell>
                              <TableCell>
                                {formatCellNumber(foodMacros.protein)}
                              </TableCell>
                              <TableCell>{formatCellNumber(foodMacros.carbs)}</TableCell>
                              <TableCell>{formatCellNumber(foodMacros.fat)}</TableCell>
                              <TableCell>{formatCellNumber(foodMacros.fiber)}</TableCell>
                              <TableCell>
                                <Button
                                  variant="contained"
                                  size="small"
                                  onClick={() => markItemComplete(item, index)}
                                  disabled={foodCompletionDisabled}
                                >
                                  Mark complete
                                </Button>
                              </TableCell>
                            </TableRow>
                            {(food?.ingredients ?? []).map((ingredient) => {
                              const dataIngredient = findIngredientInLookup(
                                ingredientLookup,
                                ingredient.ingredient_id,
                              );
                              const ingredientId = normalizeIngredientId(
                                ingredient.ingredient_id,
                              );
                              const isRemoved =
                                ingredientId !== null &&
                                removedIngredientIds.has(ingredientId);
                              const override =
                                foodItem.overrides[String(ingredient.ingredient_id)];
                              const defaultUnitId = normalizePlanUnitId(
                                override?.unitId ?? ingredient.unit_id,
                              );
                              const quantityPerPortion = roundDisplayValue(
                                clampNonNegative(
                                  toFiniteNumber(
                                    override?.quantity ?? ingredient.unit_quantity,
                                  ),
                                ),
                              );
                              const plannedTotal =
                                quantityPerPortion * foodItem.portions;
                              const plannedUnitName = resolveIngredientUnitName(
                                dataIngredient,
                                defaultUnitId,
                              );
                              const plannedGrams = gramsForIngredientPortion({
                                ingredient: dataIngredient,
                                unitId: defaultUnitId,
                                quantity: plannedTotal,
                              });
                              const ingredientKey = foodIngredientKey(
                                index,
                                ingredient.ingredient_id,
                              );
                              const fallbackMeasurement: IngredientMeasurement = {
                                quantity: roundDisplayValue(
                                  quantityPerPortion * actualPortions,
                                ),
                                unitId: defaultUnitId,
                              };
                              const measurement = readMeasurementWithFallback(
                                actualState.ingredientTotals,
                                ingredientKey,
                                fallbackMeasurement.quantity,
                                fallbackMeasurement.unitId,
                              );
                              const ingredientMacros = isRemoved
                                ? { ...ZERO_MACROS }
                                : macrosForIngredientPortion({
                                    ingredient: dataIngredient,
                                    unitId: measurement.unitId,
                                    quantity: measurement.quantity,
                                  });
                              const actualGrams = isRemoved
                                ? 0
                                : gramsForIngredientPortion({
                                    ingredient: dataIngredient,
                                    unitId: measurement.unitId,
                                    quantity: measurement.quantity,
                                  });
                              const rawUnitOptions = (dataIngredient?.units ?? []).map(
                                (unit) => ({
                                  id: normalizePlanUnitId(unit.id),
                                  name: unit.name ?? "",
                                }),
                              );
                              const seenUnitIds = new Set<number>();
                              const unitOptions = rawUnitOptions.filter((option) => {
                                if (seenUnitIds.has(option.id)) {
                                  return false;
                                }
                                seenUnitIds.add(option.id);
                                return true;
                              });
                              if (unitOptions.length === 0) {
                                unitOptions.push({ id: GRAM_UNIT_SENTINEL, name: "g" });
                              }
                              if (
                                !unitOptions.some(
                                  (option) => option.id === measurement.unitId,
                                )
                              ) {
                                unitOptions.push({
                                  id: measurement.unitId,
                                  name:
                                    resolveIngredientUnitName(
                                      dataIngredient,
                                      measurement.unitId,
                                    ) || "g",
                                });
                              }

                              return (
                                <TableRow
                                  key={`food-${index}-ingredient-${ingredient.ingredient_id}`}
                                >
                                  <TableCell
                                    sx={{
                                      pl: 4,
                                      color: isRemoved ? "text.secondary" : undefined,
                                    }}
                                  >
                                    {dataIngredient?.name ?? "Ingredient"}
                                  </TableCell>
                                  <TableCell>
                                    <Box sx={{ display: "flex", flexDirection: "column" }}>
                                      <Typography component="span">
                                        {`${formatCellNumber(plannedTotal)}${
                                          plannedUnitName ? ` ${plannedUnitName}` : ""
                                        }`}
                                      </Typography>
                                      <Typography
                                        component="span"
                                        variant="body2"
                                        color="text.secondary"
                                      >
                                        {`${formatCellNumber(plannedGrams)} g`}
                                      </Typography>
                                    </Box>
                                  </TableCell>
                                  <TableCell>
                                    <Box
                                      sx={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        alignItems: "center",
                                        gap: 1,
                                      }}
                                    >
                                      <DecimalInput
                                        value={measurement.quantity}
                                        onValueChange={(value) =>
                                          updateIngredientMeasurement(
                                            ingredientKey,
                                            fallbackMeasurement,
                                            { quantity: value },
                                          )
                                        }
                                        sx={{ width: 120 }}
                                        inputProps={{ min: 0, step: "any" }}
                                        disabled={isRemoved}
                                      />
                                      <Select
                                        size="small"
                                        value={measurement.unitId}
                                        disabled={isRemoved}
                                        onChange={(event) => {
                                          const selectedUnit = normalizePlanUnitId(
                                            event.target.value,
                                          );
                                          updateIngredientMeasurement(
                                            ingredientKey,
                                            fallbackMeasurement,
                                            { unitId: selectedUnit },
                                          );
                                        }}
                                      >
                                        {unitOptions.map((option) => (
                                          <MenuItem
                                            key={`${ingredientKey}-${option.id}`}
                                            value={option.id}
                                          >
                                            {option.name}
                                          </MenuItem>
                                        ))}
                                      </Select>
                                      <Typography
                                        component="span"
                                        variant="body2"
                                        color="text.secondary"
                                        sx={{ whiteSpace: "nowrap" }}
                                      >
                                        {`${formatCellNumber(actualGrams)} g`}
                                      </Typography>
                                      {isRemoved && (
                                        <Typography
                                          component="span"
                                          variant="body2"
                                          color="text.secondary"
                                        >
                                          Removed
                                        </Typography>
                                      )}
                                    </Box>
                                  </TableCell>
                                  <TableCell>
                                    {formatCellNumber(ingredientMacros.calories)}
                                  </TableCell>
                                  <TableCell>
                                    {formatCellNumber(ingredientMacros.protein)}
                                  </TableCell>
                                  <TableCell>
                                    {formatCellNumber(ingredientMacros.carbs)}
                                  </TableCell>
                                  <TableCell>
                                    {formatCellNumber(ingredientMacros.fat)}
                                  </TableCell>
                                  <TableCell>
                                    {formatCellNumber(ingredientMacros.fiber)}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      size="small"
                                      onClick={() =>
                                        toggleFoodIngredientRemoved(
                                          portionKey,
                                          String(ingredient.ingredient_id),
                                          !isRemoved,
                                        )
                                      }
                                    >
                                      {isRemoved ? "Restore" : "Remove"}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                            {foodAdjustments.addedIngredientIds.map(
                              (ingredientId) => {
                                const addedIngredient = findIngredientInLookup(
                                  ingredientLookup,
                                  ingredientId,
                                );
                                const addedKey = addedFoodIngredientKey(
                                  index,
                                  ingredientId,
                                );
                                const defaultUnitId =
                                  resolveDefaultIngredientUnitId(addedIngredient);
                                const fallbackMeasurement: IngredientMeasurement = {
                                  quantity: 0,
                                  unitId: defaultUnitId,
                                };
                                const measurement = readMeasurementWithFallback(
                                  actualState.ingredientTotals,
                                  addedKey,
                                  fallbackMeasurement.quantity,
                                  fallbackMeasurement.unitId,
                                );
                                const ingredientMacros = macrosForIngredientPortion({
                                  ingredient: addedIngredient,
                                  unitId: measurement.unitId,
                                  quantity: measurement.quantity,
                                });
                                const actualGrams = gramsForIngredientPortion({
                                  ingredient: addedIngredient,
                                  unitId: measurement.unitId,
                                  quantity: measurement.quantity,
                                });
                                const rawUnitOptions = (
                                  addedIngredient?.units ?? []
                                ).map((unit) => ({
                                  id: normalizePlanUnitId(unit.id),
                                  name: unit.name ?? "",
                                }));
                                const seenUnitIds = new Set<number>();
                                const unitOptions = rawUnitOptions.filter((option) => {
                                  if (seenUnitIds.has(option.id)) {
                                    return false;
                                  }
                                  seenUnitIds.add(option.id);
                                  return true;
                                });
                                if (unitOptions.length === 0) {
                                  unitOptions.push({
                                    id: GRAM_UNIT_SENTINEL,
                                    name: "g",
                                  });
                                }
                                if (
                                  !unitOptions.some(
                                    (option) => option.id === measurement.unitId,
                                  )
                                ) {
                                  unitOptions.push({
                                    id: measurement.unitId,
                                    name:
                                      resolveIngredientUnitName(
                                        addedIngredient,
                                        measurement.unitId,
                                      ) || "g",
                                  });
                                }

                                return (
                                  <TableRow
                                    key={`food-${index}-added-${ingredientId}`}
                                  >
                                    <TableCell sx={{ pl: 4 }}>
                                      {addedIngredient?.name ?? "Ingredient"}
                                    </TableCell>
                                    <TableCell>
                                      <Typography
                                        component="span"
                                        variant="body2"
                                        color="text.secondary"
                                      >
                                        Added during cooking
                                      </Typography>
                                    </TableCell>
                                    <TableCell>
                                      <Box
                                        sx={{
                                          display: "flex",
                                          flexWrap: "wrap",
                                          alignItems: "center",
                                          gap: 1,
                                        }}
                                      >
                                        <DecimalInput
                                          value={measurement.quantity}
                                          onValueChange={(value) =>
                                            updateIngredientMeasurement(
                                              addedKey,
                                              fallbackMeasurement,
                                              { quantity: value },
                                            )
                                          }
                                          sx={{ width: 120 }}
                                          inputProps={{ min: 0, step: "any" }}
                                        />
                                        <Select
                                          size="small"
                                          value={measurement.unitId}
                                          onChange={(event) => {
                                            const selectedUnit = normalizePlanUnitId(
                                              event.target.value,
                                            );
                                            updateIngredientMeasurement(
                                              addedKey,
                                              fallbackMeasurement,
                                              { unitId: selectedUnit },
                                            );
                                          }}
                                        >
                                          {unitOptions.map((option) => (
                                            <MenuItem
                                              key={`${addedKey}-${option.id}`}
                                              value={option.id}
                                            >
                                              {option.name}
                                            </MenuItem>
                                          ))}
                                        </Select>
                                        <Typography
                                          component="span"
                                          variant="body2"
                                          color="text.secondary"
                                          sx={{ whiteSpace: "nowrap" }}
                                        >
                                          {`${formatCellNumber(actualGrams)} g`}
                                        </Typography>
                                      </Box>
                                    </TableCell>
                                    <TableCell>
                                      {formatCellNumber(ingredientMacros.calories)}
                                    </TableCell>
                                    <TableCell>
                                      {formatCellNumber(ingredientMacros.protein)}
                                    </TableCell>
                                    <TableCell>
                                      {formatCellNumber(ingredientMacros.carbs)}
                                    </TableCell>
                                    <TableCell>
                                      {formatCellNumber(ingredientMacros.fat)}
                                    </TableCell>
                                    <TableCell>
                                      {formatCellNumber(ingredientMacros.fiber)}
                                    </TableCell>
                                    <TableCell>
                                      <Button
                                        size="small"
                                        onClick={() =>
                                          removeAddedFoodIngredient(
                                            portionKey,
                                            ingredientId,
                                            index,
                                          )
                                        }
                                      >
                                        Remove
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                );
                              },
                            )}
                            <TableRow key={`food-${index}-add-row`}>
                              <TableCell sx={{ pl: 4 }}>
                                <Typography
                                  component="span"
                                  variant="body2"
                                  color="text.secondary"
                                >
                                  Add ingredient
                                </Typography>
                              </TableCell>
                              <TableCell colSpan={7}>
                                <Box
                                  sx={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    alignItems: "center",
                                    gap: 1,
                                  }}
                                >
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => handleOpenIngredientPicker(portionKey)}
                                  >
                                    Select ingredient
                                  </Button>
                                </Box>
                              </TableCell>
                              <TableCell></TableCell>
                            </TableRow>
                          </React.Fragment>
                        );
                      }

                      const ingredientItem = item as IngredientPlanItem;
                  const ingredient = findIngredientInLookup(
                    ingredientLookup,
                    ingredientItem.ingredientId,
                  );
                  const defaultUnitId = normalizePlanUnitId(ingredientItem.unitId);
                  const perPortionQuantity = roundDisplayValue(
                    clampNonNegative(toFiniteNumber(ingredientItem.amount)),
                  );
                  const plannedPortions = roundDisplayValue(
                    clampNonNegative(toFiniteNumber(ingredientItem.portions ?? 1)),
                  );
                  const plannedQuantity = roundDisplayValue(
                    perPortionQuantity * (plannedPortions > 0 ? plannedPortions : 1),
                  );
                  const plannedUnitName = resolveIngredientUnitName(
                    ingredient,
                    defaultUnitId,
                  );
                  const plannedGrams = gramsForIngredientPortion({
                    ingredient,
                    unitId: defaultUnitId,
                    quantity: plannedQuantity,
                  });
                  const ingredientKey = planItemKey(item, index);
                  const fallbackMeasurement: IngredientMeasurement = {
                    quantity: roundDisplayValue(plannedQuantity),
                    unitId: defaultUnitId,
                  };
                  const measurement = readMeasurementWithFallback(
                    actualState.ingredientTotals,
                    ingredientKey,
                    fallbackMeasurement.quantity,
                    fallbackMeasurement.unitId,
                  );
                  const ingredientMacros = macrosForIngredientPortion({
                    ingredient,
                    unitId: measurement.unitId,
                    quantity: measurement.quantity,
                  });
                  const actualGrams = gramsForIngredientPortion({
                    ingredient,
                    unitId: measurement.unitId,
                    quantity: measurement.quantity,
                  });
                  const rawUnitOptions = (ingredient?.units ?? []).map((unit) => ({
                    id: normalizePlanUnitId(unit.id),
                    name: unit.name ?? "",
                  }));
                  const seenUnitIds = new Set<number>();
                  const unitOptions = rawUnitOptions.filter((option) => {
                    if (seenUnitIds.has(option.id)) {
                      return false;
                    }
                    seenUnitIds.add(option.id);
                    return true;
                  });
                  if (unitOptions.length === 0) {
                    unitOptions.push({ id: GRAM_UNIT_SENTINEL, name: "g" });
                  }
                  if (!unitOptions.some((option) => option.id === measurement.unitId)) {
                    unitOptions.push({
                      id: measurement.unitId,
                      name:
                        resolveIngredientUnitName(ingredient, measurement.unitId) || "g",
                    });
                  }

                      return (
                    <TableRow key={key}>
                      <TableCell>{ingredient?.name ?? "Ingredient"}</TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", flexDirection: "column" }}>
                            <Typography component="span">
                              {`${formatCellNumber(plannedQuantity)}${
                                plannedUnitName ? ` ${plannedUnitName}` : ""
                              }`}
                            </Typography>
                            <Typography
                              component="span"
                              variant="body2"
                              color="text.secondary"
                            >
                              {`${formatCellNumber(perPortionQuantity)}${
                                plannedUnitName ? ` ${plannedUnitName}` : ""
                              } × ${formatCellNumber(plannedPortions)} portions`}
                            </Typography>
                            <Typography
                              component="span"
                              variant="body2"
                              color="text.secondary"
                            >
                              {`${formatCellNumber(plannedGrams)} g`}
                            </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box
                            sx={{
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              gap: 1,
                            }}
                        >
                              <DecimalInput
                                value={measurement.quantity}
                                onValueChange={(value) =>
                                  updateIngredientMeasurement(ingredientKey, fallbackMeasurement, {
                                    quantity: value,
                                  })
                                }
                                sx={{ width: 120 }}
                                inputProps={{ min: 0, step: "any" }}
                              />
                            <Select
                              size="small"
                              value={measurement.unitId}
                              onChange={(event) => {
                                const selectedUnit = normalizePlanUnitId(event.target.value);
                                updateIngredientMeasurement(
                                  ingredientKey,
                                  fallbackMeasurement,
                                  { unitId: selectedUnit },
                                );
                              }}
                            >
                              {unitOptions.map((option) => (
                                <MenuItem
                                  key={`${ingredientKey}-${option.id}`}
                                  value={option.id}
                                >
                                  {option.name}
                                </MenuItem>
                              ))}
                            </Select>
                            <Typography
                              component="span"
                              variant="body2"
                              color="text.secondary"
                              sx={{ whiteSpace: "nowrap" }}
                            >
                              {`${formatCellNumber(actualGrams)} g`}
                            </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        {formatCellNumber(ingredientMacros.calories)}
                      </TableCell>
                      <TableCell>
                        {formatCellNumber(ingredientMacros.protein)}
                      </TableCell>
                      <TableCell>
                        {formatCellNumber(ingredientMacros.carbs)}
                      </TableCell>
                      <TableCell>
                        {formatCellNumber(ingredientMacros.fat)}
                      </TableCell>
                      <TableCell>
                        {formatCellNumber(ingredientMacros.fiber)}
                      </TableCell>
                      <TableCell>
                        <Button
                            variant="contained"
                            size="small"
                            onClick={() => markItemComplete(item, index)}
                            disabled={
                              !ingredient ||
                              measurement.quantity <= 0 ||
                              pendingCompletionKeys.has(key)
                            }
                        >
                            Mark complete
                        </Button>
                      </TableCell>
                    </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              <Box>
            <Typography variant="h6" component="h2" gutterBottom>
              Actual Nutrition Summary
            </Typography>
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell></TableCell>
                    <TableCell>Calories</TableCell>
                    <TableCell>Protein</TableCell>
                    <TableCell>Carbs</TableCell>
                    <TableCell>Fat</TableCell>
                    <TableCell>Fiber</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>Total</TableCell>
                    <TableCell>
                      {formatCellNumber(totalActualMacros.calories)}
                    </TableCell>
                    <TableCell>
                      {formatCellNumber(totalActualMacros.protein)}
                    </TableCell>
                    <TableCell>
                      {formatCellNumber(totalActualMacros.carbs)}
                    </TableCell>
                    <TableCell>{formatCellNumber(totalActualMacros.fat)}</TableCell>
                    <TableCell>
                      {formatCellNumber(totalActualMacros.fiber)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Per Day</TableCell>
                    <TableCell>
                      {formatCellNumber(perDayActualMacros.calories)}
                    </TableCell>
                    <TableCell>
                      {formatCellNumber(perDayActualMacros.protein)}
                    </TableCell>
                    <TableCell>
                      {formatCellNumber(perDayActualMacros.carbs)}
                    </TableCell>
                    <TableCell>
                      {formatCellNumber(perDayActualMacros.fat)}
                    </TableCell>
                    <TableCell>
                      {formatCellNumber(perDayActualMacros.fiber)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
            </>
          ) : (
            <Alert severity="success">
              All plan items have been marked complete.
            </Alert>
          )}
        </>
      )}
      <Dialog
        open={ingredientPickerOpen}
        onClose={handleCloseIngredientPicker}
        fullWidth
        maxWidth="lg"
        scroll="paper"
      >
        <DialogTitle>Select Ingredient</DialogTitle>
        <IngredientTable onIngredientDoubleClick={handleAddIngredient} />
        <DialogActions>
          <Button onClick={handleOpenIngredientModal}>New Ingredient</Button>
          <Button onClick={handleCloseIngredientPicker}>Close</Button>
        </DialogActions>
      </Dialog>
      <IngredientModal
        open={ingredientModalOpen}
        mode="add"
        ingredient={null}
        onClose={handleCloseIngredientModal}
      />
      <FeedbackSnackbar snackbar={feedback} onClose={handleFeedbackClose} />
    </Stack>
  );
}

export default Cooking;
