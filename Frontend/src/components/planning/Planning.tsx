import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import ListAltIcon from "@mui/icons-material/ListAlt";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SaveIcon from "@mui/icons-material/Save";

import { useLocation, useNavigate } from "react-router-dom";
import { useData } from "@/contexts/DataContext";
import { formatCellNumber } from "@/utils/utils";
import {
  addMacroTotals,
  scaleMacroTotals,
  scaleNutrient,
  UNKNOWN_MACROS,
  ZERO_TARGETS,
  createIngredientLookup,
  macrosForFood,
  macrosForIngredientPortion,
  ZERO_MACROS,
  findIngredientInLookup,
} from "@/utils/nutrition";
import type { FoodRead, IngredientRead } from "@/utils/nutrition";
import IngredientModal from "@/components/common/IngredientModal";
import IngredientTable from "@/components/data/ingredient/IngredientTable";
import FoodTable from "@/components/data/food/FoodTable";
import DecimalInput from "@/components/common/DecimalInput";
import useHoverable from "@/hooks/useHoverable";
import { useSessionStorageState } from "@/hooks/useSessionStorageState";
import type { PlanRead } from "@/utils/planApi";
import { usePlanApi } from "@/utils/planApi";
import type {
  FoodOverride,
  FoodPlanItem,
  IngredientPlanItem,
  PlanItem,
  PlanPayload,
} from "@/utils/planningTypes";

const GRAM_UNIT_SENTINEL = 0;

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

const ingredientSupportsUnit = (
  ingredient: IngredientRead | undefined,
  unitId: number,
): boolean => {
  if (!ingredient || !Array.isArray(ingredient.units) || ingredient.units.length === 0) {
    return true;
  }
  return ingredient.units.some(
    (unit) => normalizePlanUnitId(unit.id) === unitId,
  );
};

const fallbackUnitIdForIngredient = (ingredient: IngredientRead | undefined): number => {
  if (!ingredient || !Array.isArray(ingredient.units) || ingredient.units.length === 0) {
    return GRAM_UNIT_SENTINEL;
  }
  const gramUnit = ingredient.units.find(
    (unit) => toFiniteNumber(unit.grams) === 1,
  );
  if (gramUnit) {
    return normalizePlanUnitId(gramUnit.id);
  }
  const firstUnit = ingredient.units[0];
  return normalizePlanUnitId(firstUnit?.id ?? null);
};

const formatPlanTimestamp = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

type NameWithEditProps = {
  name: string;
  onEdit: () => void;
};

type MacroKey = keyof PlanPayload["targetMacros"];

const NameWithEdit: React.FC<NameWithEditProps> = ({ name, onEdit }) => {
  const { hovered, bind } = useHoverable();

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }} {...bind}>
      <span>{name}</span>
      {hovered && (
        <Tooltip title="Edit ingredient (add units, nutrition, tags)">
          <IconButton size="small" aria-label="edit ingredient" onClick={onEdit}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};

function Planning() {
  const { createPlan, updatePlan } = usePlanApi();
  const { foods, ingredients, fridgeInventory } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const ingredientLookup = useMemo(() => createIngredientLookup(ingredients), [ingredients]);

  const [days, setDays] = useSessionStorageState<number>("planning-days", 1);
  const [daysError, setDaysError] = useState(false);
  const [targetMacros, setTargetMacros] = useSessionStorageState<PlanPayload["targetMacros"]>("planning-target-macros", () => ({
    ...ZERO_TARGETS,
  }));
  const macroKeys = useMemo(() => Object.keys(targetMacros) as MacroKey[], [targetMacros]);
  const [plan, setPlan] = useSessionStorageState<PlanItem[]>("planning-plan", () => []); // FoodPlanItem or IngredientPlanItem
  const [includeFridge, setIncludeFridge] = useSessionStorageState<boolean>(
    "planning-include-fridge",
    false,
  );

  const [activePlan, setActivePlan] = useSessionStorageState<{
    id: number | null;
    label: string | null;
    updatedAt: string | null;
  }>("planning-active-plan", () => ({
    id: null,
    label: null,
    updatedAt: null,
  }));
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useSessionStorageState("planning-save-label", "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"create" | "update" | null>(null);
  const lastSavedPayloadRef = useRef<PlanPayload | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const [open, setOpen] = useSessionStorageState<Record<number, boolean>>("planning-open-state", () => ({}));
  const [ingredientModalOpen, setIngredientModalOpen] = useState(false);
  const [editorIngredient, setEditorIngredient] = useState<IngredientRead | null>(null);
  const [ingredientPickerOpen, setIngredientPickerOpen] = useState(false);
  const [foodPickerOpen, setFoodPickerOpen] = useState(false);

  useEffect(() => {
    setPlan((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (item.type !== "ingredient") {
          return item;
        }
        const ingredientItem = item as IngredientPlanItem;
        const normalizedPortions = toFiniteNumber(ingredientItem.portions);
        if (normalizedPortions > 0 && Number.isFinite(normalizedPortions)) {
          if (ingredientItem.portions === normalizedPortions) {
            return ingredientItem;
          }
          changed = true;
          return {
            ...ingredientItem,
            portions: normalizedPortions,
          } as IngredientPlanItem;
        }
        changed = true;
        return {
          ...ingredientItem,
          portions: 1,
        } as IngredientPlanItem;
      });
      return changed ? next : prev;
    });
  }, [setPlan]);

  const hasContent = useMemo(
    () =>
      plan.length > 0 ||
      days !== 1 ||
      Object.values(targetMacros).some((value) => value !== 0),
    [plan, days, targetMacros]
  );
  const canResetPlan = hasContent || activePlan.id !== null;


  const handleOpenIngredientEditor = (ingredientId: string) => {
    const dataIngredient = findIngredientInLookup(ingredientLookup, ingredientId) ?? null;
    setEditorIngredient(dataIngredient);
    setIngredientModalOpen(Boolean(dataIngredient));
  };

  const sanitizePlanItems = useCallback((): PlanItem[] => {
    return plan.map((item) => {
      if (item.type === "food") {
        const overrides: Record<string, FoodOverride> = {};
        Object.entries(item.overrides ?? {}).forEach(([key, value]) => {
          if (!value) {
            overrides[key] = { unitId: GRAM_UNIT_SENTINEL, quantity: 0 };
            return;
          }
          overrides[key] = {
            unitId: normalizePlanUnitId(value.unitId),
            quantity: typeof value.quantity === "number" ? value.quantity : Number(value.quantity ?? 0),
          };
        });
        return {
          type: "food",
          foodId: item.foodId,
          portions: item.portions,
          overrides,
        } as FoodPlanItem;
      }
      const amount = toFiniteNumber((item as IngredientPlanItem).amount);
      const portions = toFiniteNumber((item as IngredientPlanItem).portions);
      return {
        type: "ingredient",
        ingredientId: item.ingredientId,
        unitId: normalizePlanUnitId(item.unitId),
        amount,
        portions: portions > 0 ? portions : 1,
      } as IngredientPlanItem;
    });
  }, [plan]);

  const buildPayload = useCallback((): PlanPayload => ({
    days,
    targetMacros: { ...targetMacros },
    plan: sanitizePlanItems(),
  }), [days, targetMacros, sanitizePlanItems]);

  const applySavedPlan = useCallback(
    (saved: PlanRead, message?: string) => {
      const rawPayload = (saved.payload ?? {}) as Partial<PlanPayload>;
      const normalizedDays =
        typeof rawPayload.days === "number" && rawPayload.days > 0 ? Math.floor(rawPayload.days) : 1;
      const normalizedTarget: PlanPayload["targetMacros"] = {
        calories: Number(rawPayload.targetMacros?.calories ?? 0),
        protein: Number(rawPayload.targetMacros?.protein ?? 0),
        carbs: Number(rawPayload.targetMacros?.carbs ?? 0),
        fat: Number(rawPayload.targetMacros?.fat ?? 0),
        fiber: Number(rawPayload.targetMacros?.fiber ?? 0),
      };
      const normalizedPlan: PlanItem[] = Array.isArray(rawPayload.plan)
        ? rawPayload.plan
            .map((item) => {
              if (!item || typeof item !== "object" || !("type" in item)) {
                return null;
              }
              if ((item as PlanItem).type === "food") {
                const overrides: Record<string, FoodOverride> = {};
                const rawOverrides = (item as FoodPlanItem).overrides ?? {};
                Object.entries(rawOverrides).forEach(([key, override]) => {
                  if (!override) return;
                  overrides[key] = {
                    unitId: normalizePlanUnitId((override as FoodOverride).unitId),
                    quantity: Number((override as FoodOverride).quantity ?? 0),
                  };
                });
                return {
                  type: "food" as const,
                  foodId: String((item as FoodPlanItem).foodId ?? ""),
                  portions: Number((item as FoodPlanItem).portions ?? 0) || 0,
                  overrides,
                } as FoodPlanItem;
              }
              if ((item as PlanItem).type === "ingredient") {
                const rawIngredient = item as IngredientPlanItem;
                const amount = toFiniteNumber(rawIngredient.amount);
                const portions = toFiniteNumber(rawIngredient.portions);
                return {
                  type: "ingredient" as const,
                  ingredientId: String(rawIngredient.ingredientId ?? ""),
                  unitId: normalizePlanUnitId(rawIngredient.unitId),
                  amount,
                  portions: portions > 0 ? portions : 1,
                } as IngredientPlanItem;
              }
              return null;
            })
            .filter(Boolean) as PlanItem[]
        : [];

      setDays(normalizedDays);
      setDaysError(false);
      setTargetMacros(normalizedTarget);
      setPlan(normalizedPlan);
      setOpen({});
      setActivePlan({
        id: saved.id ?? null,
        label: saved.label ?? null,
        updatedAt: saved.updated_at ?? saved.created_at ?? null,
      });
      setSaveLabel(saved.label ?? "");
      lastSavedPayloadRef.current = {
        days: normalizedDays,
        targetMacros: normalizedTarget,
        plan: normalizedPlan.map((item) =>
          item.type === "food" ? { ...item, overrides: { ...item.overrides } } : { ...item }
        ),
      };
      setIsDirty(false);
      setStatusMessage(message ?? `Loaded plan "${saved.label}"`);
      setSaveError(null);
  }, [
    lastSavedPayloadRef,
    setActivePlan,
    setDays,
    setDaysError,
    setIsDirty,
    setOpen,
    setPlan,
    setSaveError,
    setSaveLabel,
    setStatusMessage,
    setTargetMacros,
  ]);

  useEffect(() => {
    const current = buildPayload();
    const last = lastSavedPayloadRef.current;
    if (!last) {
      lastSavedPayloadRef.current = current;
      setIsDirty(hasContent);
      return;
    }
    const dirty =
      last.days !== current.days ||
      JSON.stringify(last.targetMacros) !== JSON.stringify(current.targetMacros) ||
      JSON.stringify(last.plan) !== JSON.stringify(current.plan);
    setIsDirty(dirty);
  }, [buildPayload, hasContent]);

  useEffect(() => {
    const state = location.state as { savedPlan?: PlanRead } | null;
    if (state?.savedPlan) {
      applySavedPlan(state.savedPlan, `Loaded plan "${state.savedPlan.label}"`);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [applySavedPlan, location.pathname, location.state, navigate]);

  useEffect(() => {
    if (isDirty) {
      setStatusMessage(null);
    }
  }, [isDirty]);

  useEffect(() => {
    if (plan.length === 0) {
      return;
    }

    let changed = false;
    const adjustedPlan = plan.map((item) => {
      if (item.type === "ingredient") {
        const ingredient = findIngredientInLookup(
          ingredientLookup,
          (item as IngredientPlanItem).ingredientId,
        );
        const normalizedUnitId = normalizePlanUnitId((item as IngredientPlanItem).unitId);
        if (!ingredientSupportsUnit(ingredient, normalizedUnitId)) {
          const fallbackUnitId = fallbackUnitIdForIngredient(ingredient);
          if (fallbackUnitId !== normalizedUnitId) {
            changed = true;
            return {
              ...(item as IngredientPlanItem),
              unitId: fallbackUnitId,
            } as IngredientPlanItem;
          }
        }
        return item;
      }

      if (item.type === "food") {
        const foodItem = item as FoodPlanItem;
        const overrides: Record<string, FoodOverride> = { ...foodItem.overrides };
        let overridesChanged = false;

        Object.entries(overrides).forEach(([key, override]) => {
          if (!override) return;
          const dataIngredient = findIngredientInLookup(ingredientLookup, key);
          if (!dataIngredient) return;
          const normalizedOverrideUnitId = normalizePlanUnitId(override.unitId);
          if (ingredientSupportsUnit(dataIngredient, normalizedOverrideUnitId)) {
            const normalizedQuantity = toFiniteNumber(override.quantity);
            if (normalizedQuantity !== override.quantity) {
              overridesChanged = true;
              overrides[key] = {
                ...override,
                quantity: normalizedQuantity,
              };
            }
            return;
          }
          const fallbackUnitId = fallbackUnitIdForIngredient(dataIngredient);
          const normalizedQuantity = toFiniteNumber(override.quantity);
          if (
            fallbackUnitId !== normalizedOverrideUnitId ||
            normalizedQuantity !== override.quantity
          ) {
            overridesChanged = true;
            overrides[key] = {
              unitId: fallbackUnitId,
              quantity: normalizedQuantity,
            };
          }
        });

        const food = foods.find(
          (f) => String(f.id ?? "") === String(foodItem.foodId ?? ""),
        );
        food?.ingredients?.forEach((foodIngredient) => {
          const ingredientId = foodIngredient.ingredient_id;
          if (ingredientId === null || ingredientId === undefined) return;
          const dataIngredient = findIngredientInLookup(ingredientLookup, ingredientId);
          if (!dataIngredient) return;
          const normalizedDefaultUnitId = normalizePlanUnitId(foodIngredient.unit_id);
          if (ingredientSupportsUnit(dataIngredient, normalizedDefaultUnitId)) {
            return;
          }

          const key = String(ingredientId);
          const existingOverride = overrides[key];
          if (existingOverride) {
            const normalizedExistingUnitId = normalizePlanUnitId(existingOverride.unitId);
            if (ingredientSupportsUnit(dataIngredient, normalizedExistingUnitId)) {
              const normalizedQuantity = toFiniteNumber(existingOverride.quantity);
              if (normalizedQuantity !== existingOverride.quantity) {
                overridesChanged = true;
                overrides[key] = {
                  ...existingOverride,
                  quantity: normalizedQuantity,
                };
              }
              return;
            }
          }

          const fallbackUnitId = fallbackUnitIdForIngredient(dataIngredient);
          const normalizedQuantity = toFiniteNumber(
            existingOverride?.quantity ?? foodIngredient.unit_quantity,
          );
          overridesChanged = true;
          overrides[key] = {
            unitId: fallbackUnitId,
            quantity: normalizedQuantity,
          };
        });

        if (overridesChanged) {
          changed = true;
          return {
            ...foodItem,
            overrides,
          } as FoodPlanItem;
        }
      }

      return item;
    });

    if (changed) {
      setPlan(adjustedPlan);
    }
  }, [plan, foods, ingredientLookup, setPlan]);

  // Change unit while preserving total grams
  const handleUnitChange = (
    index: number,
    newUnitId: number,
    opts?: { ingredientId?: string }
  ) => {
    const updated = [...plan];
    const item = updated[index];
    if (!item) return;

    // Helper to get grams for a unit of an ingredient
    const getUnitGrams = (ingredientId: string, unitId: number) => {
      const ing = ingredients.find((i) => i.id === ingredientId);
      const units = ing?.units ?? [];
      const unit =
        units.find((u) => {
          if (u.id === null || u.id === undefined) {
            return unitId === GRAM_UNIT_SENTINEL;
          }
          return u.id === unitId;
        }) ||
        units.find((u) => Number(u.grams) === 1) ||
        units.find((u) => u.name === "1g") ||
        units[0];
      return unit?.grams ?? 0;
    };

    if (item.type === "food" && opts?.ingredientId) {
      const foodItem = item as FoodPlanItem;
      const ingredientId = opts.ingredientId;
      const dataIng = ingredients.find((i) => i.id === ingredientId);
      if (!dataIng) return;

      const currentOverride = foodItem.overrides[ingredientId];
      const currentUnitId = currentOverride?.unitId ?? 0;
      const currentQuantity = currentOverride?.quantity ?? 0;

      const currentGrams = getUnitGrams(ingredientId, currentUnitId) * currentQuantity;
      const newUnitGrams = getUnitGrams(ingredientId, newUnitId);

      // Avoid division by zero
      const newQuantity = newUnitGrams > 0 ? currentGrams / newUnitGrams : currentQuantity;

      foodItem.overrides = {
        ...foodItem.overrides,
        [ingredientId]: {
          unitId: newUnitId,
          quantity: newQuantity,
        },
      };
      updated[index] = { ...foodItem };
      setPlan(updated);
      return;
    }

    if (item.type === "ingredient") {
      const ingredientId = (item as IngredientPlanItem).ingredientId;
      const currentUnitId = (item as IngredientPlanItem).unitId;
      const currentAmount = (item as IngredientPlanItem).amount;

      const currentGrams = getUnitGrams(ingredientId, currentUnitId) * currentAmount;
      const newUnitGrams = getUnitGrams(ingredientId, newUnitId);
      const newAmount = newUnitGrams > 0 ? currentGrams / newUnitGrams : currentAmount;

      updated[index] = {
        ...(item as IngredientPlanItem),
        unitId: newUnitId,
        amount: newAmount,
      } as IngredientPlanItem;
      setPlan(updated);
      return;
    }
  };

  const handleAddIngredientToPlan = useCallback(
    (ingredient: IngredientRead) => {
      if (!ingredient || ingredient.id === null || ingredient.id === undefined) {
        return;
      }
      const ingredientId = String(ingredient.id);
      const fallbackUnitId = fallbackUnitIdForIngredient(ingredient);
      setPlan((prev) => [
        ...prev,
        {
          type: "ingredient",
          ingredientId,
          unitId: fallbackUnitId,
          amount: 1,
          portions: 1,
        } as IngredientPlanItem,
      ]);
      setIngredientPickerOpen(false);
    },
    [setPlan, setIngredientPickerOpen],
  );

  const handleAddFoodToPlan = useCallback(
    (food: FoodRead) => {
      if (!food || food.id === null || food.id === undefined) {
        return;
      }
      const foodId = String(food.id);
      setPlan((prev) => {
        const existingIndex = prev.findIndex(
          (item) => item.type === "food" && String(item.foodId ?? "") === foodId,
        );
        if (existingIndex >= 0) {
          const next = [...prev];
          const existing = next[existingIndex] as FoodPlanItem;
          next[existingIndex] = {
            ...existing,
            portions: existing.portions + 1,
          };
          return next;
        }

        const overrides: Record<string, FoodOverride> = {};
        (food.ingredients ?? []).forEach((ing) => {
          if (!ing) return;
          const ingredientKey = String(ing.ingredient_id);
          overrides[ingredientKey] = {
            unitId: normalizePlanUnitId(ing.unit_id),
            quantity:
              typeof ing.unit_quantity === "number"
                ? ing.unit_quantity
                : Number(ing.unit_quantity ?? 0),
          };
        });

        return [
          ...prev,
          {
            type: "food",
            foodId,
            portions: Math.max(1, Number.isFinite(days) ? Math.floor(days) : 1),
            overrides,
          } as FoodPlanItem,
        ];
      });
      setFoodPickerOpen(false);
    },
    [days, setPlan, setFoodPickerOpen],
  );

  const handleQuantityChange = (
    index: number,
    value: number,
    opts?: { ingredientId?: string }
  ) => {
    if (value < 0) return;
    const updated = [...plan];
    const item = updated[index];
    if (!item) return;
    if (item.type === "food") {
      if (opts?.ingredientId) {
        const ingredientId = opts.ingredientId;
        const foodItem = item as FoodPlanItem;
        const current = foodItem.overrides[ingredientId];
        // Only update quantity for the specific ingredient override
        foodItem.overrides = {
          ...foodItem.overrides,
          [ingredientId]: {
            unitId: normalizePlanUnitId(current?.unitId),
            quantity: value,
          },
        };
        updated[index] = { ...foodItem };
      } else {
        updated[index] = { ...item, portions: value } as FoodPlanItem;
      }
    } else {
      updated[index] = { ...(item as IngredientPlanItem), amount: value };
    }
    setPlan(updated);
  };

  const handleIngredientPortionsChange = (index: number, value: number) => {
    if (value < 0) return;
    const updated = [...plan];
    const item = updated[index];
    if (!item || item.type !== "ingredient") {
      return;
    }
    updated[index] = {
      ...(item as IngredientPlanItem),
      portions: value,
    } as IngredientPlanItem;
    setPlan(updated);
  };

  const handleRemoveItem = (index) => {
    const updated = plan.filter((_, i) => i !== index);
    setPlan(updated);
  };

  const calculateIngredientMacros = useCallback(
    (ingredient, override?: FoodOverride) => {
      if (!ingredient) return { ...ZERO_MACROS };
      const ingredientId = ingredient.ingredient_id;
      if (ingredientId === null || ingredientId === undefined) {
        return { ...ZERO_MACROS };
      }
      const dataIngredient = findIngredientInLookup(ingredientLookup, ingredientId);
      if (!dataIngredient) {
        return { ...UNKNOWN_MACROS };
      }
      return macrosForIngredientPortion({
        ingredient: dataIngredient,
        unitId: normalizePlanUnitId(override?.unitId ?? ingredient.unit_id),
        quantity: override?.quantity ?? ingredient.unit_quantity,
      });
    },
    [ingredientLookup]
  );

  const calculateFoodMacros = useCallback(
    (food, overrides?: Record<string, FoodOverride>) =>
      macrosForFood(food, ingredientLookup, overrides),
    [ingredientLookup]
  );

  const calculateItemMacros = useCallback(
    (item: PlanItem) => {
      if (item.type === "food") {
        const food = foods.find(
          (m) => String(m.id ?? "") === String(item.foodId ?? ""),
        );
        const macros = calculateFoodMacros(food, item.overrides);
        return {
          calories: scaleNutrient(macros.calories, item.portions),
          protein: scaleNutrient(macros.protein, item.portions),
          fat: scaleNutrient(macros.fat, item.portions),
          carbs: scaleNutrient(macros.carbs, item.portions),
          fiber: scaleNutrient(macros.fiber, item.portions),
        };
      }
      const perPortion = calculateIngredientMacros({
        ingredient_id: item.ingredientId,
        unit_id: normalizePlanUnitId(item.unitId),
        unit_quantity: item.amount,
      });
      return {
        calories: scaleNutrient(perPortion.calories, item.portions),
        protein: scaleNutrient(perPortion.protein, item.portions),
        fat: scaleNutrient(perPortion.fat, item.portions),
        carbs: scaleNutrient(perPortion.carbs, item.portions),
        fiber: scaleNutrient(perPortion.fiber, item.portions),
      };
    },
    [foods, calculateFoodMacros, calculateIngredientMacros]
  );

  const planTotalMacros = useMemo(() => {
    return plan.reduce(
      (totals, item) => {
        const macros = calculateItemMacros(item);
        return addMacroTotals(totals, macros);
      },
      { ...ZERO_MACROS }
    );
  }, [plan, calculateItemMacros]);

  const fridgeTotalMacros = useMemo(() => fridgeInventory.reduce((totals, item) =>
    addMacroTotals(totals, scaleMacroTotals({
      calories: item.per_portion_calories,
      protein: item.per_portion_protein,
      fat: item.per_portion_fat,
      carbs: item.per_portion_carbohydrates,
      fiber: item.per_portion_fiber,
    }, Math.max(0, item.remaining_portions))), { ...ZERO_MACROS }), [fridgeInventory]);

  const overallTotalMacros = useMemo(() => includeFridge
    ? addMacroTotals(planTotalMacros, fridgeTotalMacros) : planTotalMacros,
    [includeFridge, planTotalMacros, fridgeTotalMacros]);

  const perDayMacros = useMemo(() => scaleMacroTotals(overallTotalMacros, days > 0 ? 1 / days : 0),
    [overallTotalMacros, days]);

  const handleDaysChange = (value: number) => {
    if (!value || value < 1) {
      setDays(1);
      setDaysError(true);
      return;
    }

    const roundedValue = Math.round(value);
    setDays(roundedValue);
    setDaysError(false);
  };

  const handleOpenSaveDialog = () => {
    setSaveError(null);
    setSaveLabel(activePlan.label ?? "");
    setSaveDialogOpen(true);
  };

  const handleCloseSaveDialog = () => {
    if (saving) {
      return;
    }
    setSaveDialogOpen(false);
    setSaveError(null);
  };

  const handleSaveAsNewPlan = async () => {
    const trimmed = saveLabel.trim();
    if (!trimmed) {
      setSaveError("Plan name is required");
      return;
    }
    setSaving("create");
    try {
      const payload = buildPayload();
      const saved = await createPlan(trimmed, payload);
      applySavedPlan(saved, `Saved plan "${saved.label}"`);
      setSaveDialogOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save plan");
    } finally {
      setSaving(null);
    }
  };

  const handleUpdateExistingPlan = async () => {
    if (activePlan.id === null) {
      await handleSaveAsNewPlan();
      return;
    }
    const trimmed = saveLabel.trim();
    if (!trimmed) {
      setSaveError("Plan name is required");
      return;
    }
    setSaving("update");
    try {
      const payload = buildPayload();
      const updated = await updatePlan(activePlan.id, { label: trimmed, payload });
      applySavedPlan(updated, `Updated plan "${updated.label}"`);
      setSaveDialogOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to update plan");
    } finally {
      setSaving(null);
    }
  };

  const handleResetPlan = () => {
    if ((isDirty || activePlan.id !== null) &&
      !window.confirm("Discard the current plan? Unsaved changes will be lost.")) {
      return;
    }
    setDays(1);
    setDaysError(false);
    setTargetMacros({ ...ZERO_TARGETS });
    setPlan([]);
    setOpen({});
    setActivePlan({ id: null, label: null, updatedAt: null });
    lastSavedPayloadRef.current = null;
    setIsDirty(false);
    setStatusMessage(null);
    setSaveLabel("");
  };

  const handleManagePlans = () => {
    navigate("/data", { state: { tab: "plans" } });
  };

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{
          alignItems: { xs: "flex-start", md: "center" },
          justifyContent: "space-between",
        }}
      >
        <Box>
          <Typography variant="h4" component="h1">Planning</Typography>
          {activePlan.label ? (
            <Typography variant="body2" color="text.secondary">
              {`Editing saved plan "${activePlan.label}"`}
              {isDirty
                ? " (unsaved changes)"
                : activePlan.updatedAt
                ? ` (last saved ${formatPlanTimestamp(activePlan.updatedAt)})`
                : ""}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Build a plan and save it for later.
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Button
            variant="outlined"
            startIcon={<RestartAltIcon />}
            onClick={handleResetPlan}
            disabled={!canResetPlan}
          >
            New Empty Plan
          </Button>
          <Button
            variant="outlined"
            startIcon={<ListAltIcon />}
            onClick={handleManagePlans}
          >
            Load or Manage Saved Plans
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={handleOpenSaveDialog}
          >
            Save Plan
          </Button>
        </Stack>
      </Stack>

      {statusMessage && <Alert severity="success">{statusMessage}</Alert>}

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 3 }}>
        <DecimalInput
          label="Days"
          value={days}
          decimalPlaces={0}
          onValueChange={handleDaysChange}
          sx={{ width: 100 }}
          error={daysError}
          helperText={daysError ? "Days must be at least 1" : ""}
        />
        {macroKeys.map((macro) => (
          <DecimalInput
            key={macro}
            label={`Target ${macro}`}
            value={targetMacros[macro]}
            onValueChange={(value) =>
              setTargetMacros((prev) => ({
                ...prev,
                [macro]: value,
              }))
            }
          />
        ))}
      </Box>

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setIngredientPickerOpen(true)}
        >
          Add Ingredient
        </Button>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setFoodPickerOpen(true)}
        >
          Add Food
        </Button>
      </Stack>

      <TableContainer component={Paper} sx={{ mb: 3 }}>
        <Table>
        <TableHead>
          <TableRow>
            <TableCell></TableCell>
            <TableCell>Item</TableCell>
            <TableCell>Amount</TableCell>
            <TableCell>Calories (per portion)</TableCell>
            <TableCell>Protein (per portion)</TableCell>
            <TableCell>Carbs (per portion)</TableCell>
            <TableCell>Fat (per portion)</TableCell>
            <TableCell>Fiber (per portion)</TableCell>
            <TableCell></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {plan.map((item, index) => {
            if (item.type === "food") {
              const food = foods.find(
                (m) => String(m.id ?? "") === String(item.foodId ?? ""),
              );
              const macros = calculateFoodMacros(food, item.overrides);
              return (
                <React.Fragment key={`food-${item.foodId}`}>
                  <TableRow>
                    <TableCell onClick={() => setOpen({ ...open, [index]: !open[index] })}>
                      {open[index] ? <KeyboardArrowDownIcon /> : <KeyboardArrowRightIcon />}
                    </TableCell>
                    <TableCell>{food ? food.name : ""}</TableCell>
                    <TableCell>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <DecimalInput
                          value={item.portions}
                          onValueChange={(value) => handleQuantityChange(index, value)}
                          sx={{ width: 80 }}
                        />
                      </Box>
                    </TableCell>
                    <TableCell>{formatCellNumber(macros.calories)}</TableCell>
                    <TableCell>{formatCellNumber(macros.protein)}</TableCell>
                    <TableCell>{formatCellNumber(macros.carbs)}</TableCell>
                    <TableCell>{formatCellNumber(macros.fat)}</TableCell>
                    <TableCell>{formatCellNumber(macros.fiber)}</TableCell>
                    <TableCell>
                      <Button color="error" onClick={() => handleRemoveItem(index)}>
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={8}>
                      <Collapse in={open[index]} timeout="auto" unmountOnExit>
                        <Typography variant="h6" gutterBottom component="div">
                          Ingredients
                        </Typography>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Name</TableCell>
                              <TableCell>Unit</TableCell>
                              <TableCell>Amount</TableCell>
                              <TableCell>Calories (per portion)</TableCell>
                              <TableCell>Protein (per portion)</TableCell>
                              <TableCell>Carbs (per portion)</TableCell>
                              <TableCell>Fat (per portion)</TableCell>
                              <TableCell>Fiber (per portion)</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {food?.ingredients.map((ingredient) => {
                              const dataIngredient = findIngredientInLookup(ingredientLookup, ingredient.ingredient_id);
                              const override = item.overrides[ingredient.ingredient_id];
                              const unitId = normalizePlanUnitId(
                                override?.unitId ?? ingredient.unit_id,
                              );
                              const quantity = override?.quantity ?? ingredient.unit_quantity;
                              const ingMacros = calculateIngredientMacros(
                                ingredient,
                                { unitId, quantity },
                              );
                              return (
                                <TableRow key={ingredient.ingredient_id}>
                                  <TableCell>
                                    <NameWithEdit
                                      name={dataIngredient ? dataIngredient.name : ""}
                                      onEdit={() => handleOpenIngredientEditor(ingredient.ingredient_id)}
                                    />
                                  </TableCell>
                                  <TableCell>
                                  <TextField
                                    select
                                    value={unitId}
                                    onChange={(e) =>
                                      handleUnitChange(
                                        index,
                                          normalizePlanUnitId(e.target.value),
                                          { ingredientId: ingredient.ingredient_id }
                                        )
                                      }
                                      sx={{ minWidth: 120 }}
                                      key={`food-item-unit-${ingredient.ingredient_id}-${
                                        (dataIngredient?.units?.length) ?? 0
                                      }`}
                                    >
                                      {(dataIngredient?.units || []).map((u) => (
                                        <MenuItem
                                          key={u.id ?? `${ingredient.ingredient_id}-${u.name}`}
                                          value={normalizePlanUnitId(u.id)}
                                        >
                                          {u.name}
                                        </MenuItem>
                                      ))}
                                    </TextField>
                                  </TableCell>
                                  <TableCell>
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                      <DecimalInput
                                        value={quantity}
                                        onValueChange={(value) =>
                                          handleQuantityChange(index, value, {
                                            ingredientId: ingredient.ingredient_id,
                                          })
                                        }
                                        sx={{ width: 80 }}
                                      />
                                      <Box component="span">x {item.portions}</Box>
                                    </Box>
                                  </TableCell>
                                  <TableCell>
                                    {formatCellNumber(ingMacros.calories)}
                                  </TableCell>
                                  <TableCell>
                                    {formatCellNumber(ingMacros.protein)}
                                  </TableCell>
                                  <TableCell>
                                    {formatCellNumber(ingMacros.carbs)}
                                  </TableCell>
                                  <TableCell>
                                    {formatCellNumber(ingMacros.fat)}
                                  </TableCell>
                                  <TableCell>
                                    {formatCellNumber(ingMacros.fiber)}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            } else {
              const ingredient = findIngredientInLookup(ingredientLookup, item.ingredientId);
              const normalizedUnitId = normalizePlanUnitId(item.unitId);
              const perPortionMacros = calculateIngredientMacros({
                ingredient_id: item.ingredientId,
                unit_id: normalizedUnitId,
                unit_quantity: item.amount,
              });
              const unitName =
                (ingredient?.units || []).find(
                  (candidate) => normalizePlanUnitId(candidate.id) === normalizedUnitId,
                )?.name ?? (normalizedUnitId === GRAM_UNIT_SENTINEL ? "g" : "");
              return (
                <TableRow key={`ingredient-${index}`}>
                  <TableCell />
                  <TableCell>
                    <NameWithEdit
                      name={ingredient ? ingredient.name : ""}
                      onEdit={() => ingredient && handleOpenIngredientEditor(ingredient.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <Box
                      sx={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 2,
                        minWidth: 260,
                        alignItems: "flex-start",
                      }}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          flexWrap: "wrap",
                        }}
                      >
                        <Typography variant="body2" sx={{ minWidth: 90 }}>
                          Portion size
                        </Typography>
                        <DecimalInput
                          value={item.amount}
                          onValueChange={(value) => handleQuantityChange(index, value)}
                          sx={{ width: 80 }}
                          inputProps={{
                            min: 0,
                            step: "any",
                            "aria-label": "portion size quantity",
                          }}
                        />
                        <TextField
                          select
                          value={normalizedUnitId}
                          onChange={(e) =>
                            handleUnitChange(index, normalizePlanUnitId(e.target.value))
                          }
                          sx={{ minWidth: 120 }}
                          key={`single-item-unit-${item.ingredientId}-${
                            (ingredient?.units?.length) ?? 0
                          }`}
                          aria-label="portion size unit"
                        >
                          {(ingredient?.units || []).map((u) => (
                            <MenuItem
                              key={u.id ?? `${item.ingredientId}-${u.name}`}
                              value={normalizePlanUnitId(u.id)}
                            >
                              {u.name}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Box>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          flexWrap: "wrap",
                        }}
                      >
                        <Typography variant="body2" sx={{ minWidth: 90 }}>
                          Portions
                        </Typography>
                        <DecimalInput
                          value={item.portions}
                          onValueChange={(value) =>
                            handleIngredientPortionsChange(index, value)
                          }
                          sx={{ width: 80 }}
                          inputProps={{
                            min: 0,
                            step: "any",
                            "aria-label": "planned portions",
                          }}
                        />
                        <Typography variant="body2" color="text.secondary">
                          {`Total: ${formatCellNumber(item.amount * item.portions)}${
                            unitName ? ` ${unitName}` : ""
                          }`}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>{formatCellNumber(perPortionMacros.calories)}</TableCell>
                  <TableCell>{formatCellNumber(perPortionMacros.protein)}</TableCell>
                  <TableCell>{formatCellNumber(perPortionMacros.carbs)}</TableCell>
                  <TableCell>{formatCellNumber(perPortionMacros.fat)}</TableCell>
                  <TableCell>{formatCellNumber(perPortionMacros.fiber)}</TableCell>
                  <TableCell>
                    <Button color="error" onClick={() => handleRemoveItem(index)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              );
            }
          })}
        </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={ingredientPickerOpen}
        onClose={() => setIngredientPickerOpen(false)}
        maxWidth="lg"
        scroll="body"
        fullWidth
      >
        <IngredientTable
          onIngredientDoubleClick={(ingredient) => {
            handleAddIngredientToPlan(ingredient as IngredientRead);
          }}
          onIngredientCtrlClick={(ingredient) => {
            if (ingredient?.id !== undefined && ingredient?.id !== null) {
              handleOpenIngredientEditor(String(ingredient.id));
            }
          }}
        />
      </Dialog>

      <Dialog
        open={foodPickerOpen}
        onClose={() => setFoodPickerOpen(false)}
        maxWidth="lg"
        scroll="body"
        fullWidth
      >
        <FoodTable
          onFoodDoubleClick={(food) => {
            handleAddFoodToPlan(food as FoodRead);
          }}
        />
      </Dialog>

      <Box>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ mb: 1, alignItems: { xs: "flex-start", sm: "center" } }}
        >
          <Typography variant="h5" component="h2">
            Summary
          </Typography>
          <FormControlLabel
            control={(
              <Checkbox
                checked={includeFridge}
                onChange={(event) => setIncludeFridge(event.target.checked)}
                slotProps={{ input: { "aria-label": "Include fridge inventory" } }}
              />
            )}
            label="Include fridge inventory"
          />
        </Stack>
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
            {includeFridge && (
              <>
                <TableRow>
                  <TableCell>Total in Fridge</TableCell>
                  <TableCell>{formatCellNumber(fridgeTotalMacros.calories)}</TableCell>
                  <TableCell>{formatCellNumber(fridgeTotalMacros.protein)}</TableCell>
                  <TableCell>{formatCellNumber(fridgeTotalMacros.carbs)}</TableCell>
                  <TableCell>{formatCellNumber(fridgeTotalMacros.fat)}</TableCell>
                  <TableCell>{formatCellNumber(fridgeTotalMacros.fiber)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Total in Plan</TableCell>
                  <TableCell>{formatCellNumber(planTotalMacros.calories)}</TableCell>
                  <TableCell>{formatCellNumber(planTotalMacros.protein)}</TableCell>
                  <TableCell>{formatCellNumber(planTotalMacros.carbs)}</TableCell>
                  <TableCell>{formatCellNumber(planTotalMacros.fat)}</TableCell>
                  <TableCell>{formatCellNumber(planTotalMacros.fiber)}</TableCell>
                </TableRow>
              </>
            )}
            <TableRow>
              <TableCell>Total Overall</TableCell>
              <TableCell>{formatCellNumber(overallTotalMacros.calories)}</TableCell>
              <TableCell>{formatCellNumber(overallTotalMacros.protein)}</TableCell>
              <TableCell>{formatCellNumber(overallTotalMacros.carbs)}</TableCell>
              <TableCell>{formatCellNumber(overallTotalMacros.fat)}</TableCell>
              <TableCell>{formatCellNumber(overallTotalMacros.fiber)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Per Day</TableCell>
              <TableCell>{formatCellNumber(perDayMacros.calories)}</TableCell>
              <TableCell>{formatCellNumber(perDayMacros.protein)}</TableCell>
              <TableCell>{formatCellNumber(perDayMacros.carbs)}</TableCell>
              <TableCell>{formatCellNumber(perDayMacros.fat)}</TableCell>
              <TableCell>{formatCellNumber(perDayMacros.fiber)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Target</TableCell>
              <TableCell>{targetMacros.calories}</TableCell>
              <TableCell>{targetMacros.protein}</TableCell>
              <TableCell>{targetMacros.carbs}</TableCell>
              <TableCell>{targetMacros.fat}</TableCell>
              <TableCell>{targetMacros.fiber}</TableCell>
            </TableRow>
          </TableBody>
          </Table>
        </TableContainer>
      </Box>
      <Dialog open={saveDialogOpen} onClose={handleCloseSaveDialog} fullWidth maxWidth="xs">
        <DialogTitle>Save Plan</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField
            label="Plan name"
            value={saveLabel}
            onChange={(event) => setSaveLabel(event.target.value)}
            autoFocus
          />
          {activePlan.label && (
            <Typography variant="body2" color="text.secondary">
              {`Currently editing "${activePlan.label}". Choose whether to update it or save as new.`}
            </Typography>
          )}
          {saveError && <Alert severity="error">{saveError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
          <Button onClick={handleCloseSaveDialog} disabled={saving !== null}>
            Cancel
          </Button>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            {activePlan.id !== null && (
              <Button
                variant="contained"
                color="secondary"
                onClick={() => void handleUpdateExistingPlan()}
                disabled={saving === "create"}
              >
                Update Plan
              </Button>
            )}
            <Button
              variant="contained"
              onClick={() => void handleSaveAsNewPlan()}
              disabled={saving === "update"}
            >
              Save as New
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>

      <IngredientModal
        open={ingredientModalOpen}
        mode="edit"
        ingredient={editorIngredient}
        onClose={() => {
          setIngredientModalOpen(false);
          setEditorIngredient(null);
        }}
      />
    </Box>
  );
}

export default Planning;


























