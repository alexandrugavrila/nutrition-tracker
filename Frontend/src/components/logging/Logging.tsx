import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogTitle,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";

import { useAccountClient } from "@/contexts/AccountScope";
import { useData } from "@/contexts/DataContext";
import type { CookedBatch } from "@/api-extra-types";
import type { components } from "@/api-types";
import FeedbackSnackbar, {
  SnackbarMessage,
} from "@/components/common/FeedbackSnackbar";
import IngredientModal from "@/components/common/IngredientModal";
import IngredientTable from "@/components/data/ingredient/IngredientTable";
import FoodTable from "@/components/data/food/FoodTable";
import {
  parseNutrient,
  scaleNutrient,
  createIngredientLookup,
  findIngredientInLookup,
  gramsForIngredientPortion,
  macrosForIngredientPortion,
  macrosForFood,
  MacroTotals,
  scaleMacroTotals,
  sumMacroTotals,
} from "@/utils/nutrition";
import { formatCellNumber } from "@/utils/utils";

type LoggedEntry = {
  id: number;
  sourceId: number;
  label: string;
  portions: number;
  macros: MacroTotals;
};

type DailyLogEntry = {
  id: number;
  user_id: string;
  log_date: string;
  stored_food_id: number | null;
  ingredient_id: number | null;
  food_id: number | null;
  portions_consumed: number;
  calories: number | null;
  protein: number | null;
  carbohydrates: number | null;
  fat: number | null;
  fiber: number | null;
  created_at: string;
};

type DailyLogEntryMap = Record<string, DailyLogEntry[]>;

const formatIsoDate = (value: string): string => {
  try {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    const weekday = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
    }).format(date);
    const datePortion = new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      year: "2-digit",
    }).format(date);
    return `${weekday}, ${datePortion}`;
  } catch (error) {
    console.error("Unable to format date", error);
    return value;
  }
};

const computePortionMacros = (item: CookedBatch, portions: number): MacroTotals => ({
  calories: scaleNutrient(item.per_portion_calories, portions),
  protein: scaleNutrient(item.per_portion_protein, portions),
  fat: scaleNutrient(item.per_portion_fat, portions),
  carbs: scaleNutrient(item.per_portion_carbohydrates, portions),
  fiber: scaleNutrient(item.per_portion_fiber, portions),
});

type IngredientLogFormState = {
  ingredientId: string;
  unitId: string;
  quantity: string;
};

type FoodLogFormState = {
  foodId: string;
  portions: string;
};

function Logging() {
  const apiClient = useAccountClient();
  const {
    fridgeInventory,
    foods,
    ingredients,
    setFridgeNeedsRefetch,
    startRequest,
    endRequest,
    hydrating,
  } = useData();

  const [selectedDate, setSelectedDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [portionsInput, setPortionsInput] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState<SnackbarMessage | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [logsByDate, setLogsByDate] = useState<DailyLogEntryMap>({});
  const [removingStoredId, setRemovingStoredId] = useState<number | null>(null);
  const [removingLogId, setRemovingLogId] = useState<number | null>(null);
  const [ingredientLog, setIngredientLog] = useState<IngredientLogFormState>({
    ingredientId: "",
    unitId: "",
    quantity: "1",
  });
  const [foodLog, setFoodLog] = useState<FoodLogFormState>({
    foodId: "",
    portions: "1",
  });
  const [ingredientPickerOpen, setIngredientPickerOpen] = useState(false);
  const [foodPickerOpen, setFoodPickerOpen] = useState(false);
  const [ingredientModalOpen, setIngredientModalOpen] = useState(false);
  const [activeLogType, setActiveLogType] = useState<"ingredient" | "food" | null>(
    null,
  );
  const [pendingIngredientLog, setPendingIngredientLog] = useState(false);
  const [pendingFoodLog, setPendingFoodLog] = useState(false);
  const handleFeedbackClose = useCallback(() => {
    setFeedback(null);
  }, []);

  const handleOpenIngredientModal = useCallback(() => {
    setIngredientModalOpen(true);
  }, []);

  const handleCloseIngredientModal = useCallback(() => {
    setIngredientModalOpen(false);
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
    const numeric = toNumber(value);
    return Number.isFinite(numeric) ? numeric : null;
  }, [toNumber]);

  const toStringValue = useCallback((value: unknown): string => {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  }, []);

  const normalizeLogEntry = useCallback(
    (entry: Record<string, unknown>): DailyLogEntry => ({
      id: toNumber(entry.id),
      user_id: toStringValue(entry.user_id),
      log_date: toStringValue(entry.log_date),
      stored_food_id: toNullableNumber(entry.stored_food_id),
      ingredient_id: toNullableNumber(entry.ingredient_id),
      food_id: toNullableNumber(entry.food_id),
      portions_consumed: toNumber(entry.portions_consumed),
      calories: parseNutrient(entry.calories),
      protein: parseNutrient(entry.protein),
      carbohydrates: parseNutrient(entry.carbohydrates),
      fat: parseNutrient(entry.fat),
      fiber: parseNutrient(entry.fiber),
      created_at: toStringValue(entry.created_at),
    }),
    [toNumber, toNullableNumber, toStringValue],
  );

  const ingredientLookup = useMemo(
    () => createIngredientLookup(ingredients),
    [ingredients],
  );

  const foodLookup = useMemo(() => {
    const map = new Map<string, components["schemas"]["FoodRead"]>();
    foods.forEach((food) => {
      if (food.id !== null && food.id !== undefined) {
        map.set(String(food.id), food);
      }
    });
    return map;
  }, [foods]);

  const selectedIngredient = useMemo(() => {
    if (!ingredientLog.ingredientId) {
      return undefined;
    }
    return findIngredientInLookup(ingredientLookup, ingredientLog.ingredientId);
  }, [ingredientLookup, ingredientLog.ingredientId]);

  const handleIngredientSelection = useCallback(
    (ingredient: components["schemas"]["IngredientRead"]) => {
      const defaultUnit = ingredient.units?.[0];
      setIngredientLog({
        ingredientId:
          ingredient.id === null || ingredient.id === undefined
            ? ""
            : String(ingredient.id),
        unitId:
          defaultUnit?.id === null || defaultUnit?.id === undefined
            ? ""
            : String(defaultUnit.id),
        quantity: "1",
      });
      setIngredientPickerOpen(false);
    },
    [setIngredientLog, setIngredientPickerOpen],
  );

  const ingredientUnitId = ingredientLog.unitId === "" ? null : ingredientLog.unitId;

  const ingredientMacros = useMemo(
    () =>
      macrosForIngredientPortion({
        ingredient: selectedIngredient,
        unitId: ingredientUnitId,
        quantity: ingredientLog.quantity,
      }),
    [selectedIngredient, ingredientUnitId, ingredientLog.quantity],
  );

  const ingredientGrams = useMemo(
    () =>
      gramsForIngredientPortion({
        ingredient: selectedIngredient,
        unitId: ingredientUnitId,
        quantity: ingredientLog.quantity,
      }),
    [selectedIngredient, ingredientUnitId, ingredientLog.quantity],
  );

  const selectedIngredientUnit = useMemo(() => {
    if (!selectedIngredient) {
      return undefined;
    }
    return (selectedIngredient.units ?? []).find((unit) => {
      const unitKey = unit?.id == null ? "" : String(unit.id);
      return unitKey === ingredientLog.unitId;
    });
  }, [selectedIngredient, ingredientLog.unitId]);

  const ingredientQuantityValue = useMemo(() => {
    const parsed = Number.parseFloat(ingredientLog.quantity);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [ingredientLog.quantity]);

  const canSubmitIngredientLog = useMemo(() => {
    if (!selectedIngredient) {
      return false;
    }
    if (!Number.isFinite(ingredientQuantityValue) || ingredientQuantityValue <= 0) {
      return false;
    }
    if (!Number.isFinite(ingredientGrams) || ingredientGrams <= 0) {
      return false;
    }
    return true;
  }, [selectedIngredient, ingredientQuantityValue, ingredientGrams]);

  const selectedFood = useMemo(() => {
    if (!foodLog.foodId) {
      return undefined;
    }
    return foodLookup.get(foodLog.foodId);
  }, [foodLookup, foodLog.foodId]);

  const handleFoodSelection = useCallback(
    (food: components["schemas"]["FoodRead"]) => {
      setFoodLog({
        foodId:
          food.id === null || food.id === undefined ? "" : String(food.id),
        portions: "1",
      });
      setFoodPickerOpen(false);
    },
    [setFoodLog, setFoodPickerOpen],
  );

  const foodPortionValue = useMemo(() => {
    const parsed = Number.parseFloat(foodLog.portions);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [foodLog.portions]);

  const foodBaseMacros = useMemo(
    () => macrosForFood(selectedFood, ingredientLookup),
    [selectedFood, ingredientLookup],
  );

  const foodLogMacros = useMemo(
    () => scaleMacroTotals(foodBaseMacros, foodPortionValue),
    [foodBaseMacros, foodPortionValue],
  );

  const canSubmitFoodLog = useMemo(() => {
    if (!selectedFood) {
      return false;
    }
    return Number.isFinite(foodPortionValue) && foodPortionValue > 0;
  }, [selectedFood, foodPortionValue]);

  useEffect(() => {
    setPortionsInput((prev) => {
      const next = { ...prev };
      fridgeInventory.forEach((item) => {
        if (next[item.id] === undefined) {
          next[item.id] = "1";
        }
      });
      return next;
    });
  }, [fridgeInventory]);

  const fetchLogsForDate = useCallback(
    async (targetDate: string): Promise<DailyLogEntry[] | null> => {
      if (!targetDate) {
        return [];
      }

      startRequest();
      try {
        const request = apiClient
          .path(`/api/logs/${targetDate}`)
          .method("get")
          .create();
        const response = await request({});
        const data = Array.isArray(response.data) ? response.data : [];
        return data.map((entry) =>
          normalizeLogEntry(entry as Record<string, unknown>),
        );
      } catch (error) {
        console.error("Failed to fetch daily logs", error);
        setFeedback({
          severity: "error",
          message: "Failed to load logs for the selected date.",
        });
        return null;
      } finally {
        endRequest();
      }
    },
    [startRequest, endRequest, normalizeLogEntry, setFeedback],
  );

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      const entries = await fetchLogsForDate(selectedDate);
      if (!isMounted || entries === null) {
        return;
      }
      setLogsByDate((prev) => ({
        ...prev,
        [selectedDate]: entries,
      }));
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [selectedDate, fetchLogsForDate]);

  const groupedInventory = useMemo(
    () =>
      [
        {
          key: "all",
          label: "Fridge Items",
          items: fridgeInventory,
        },
      ].filter((group) => group.items.length > 0),
    [fridgeInventory],
  );

  const resolveDisplayName = useCallback(
    (item: CookedBatch): string => {
      if (item.label) {
        return item.label;
      }
      if (item.food_id != null) {
        const food = foodLookup.get(String(item.food_id));
        if (food?.name) {
          return food.name;
        }
      }
      if (item.ingredient_id != null) {
        const ingredient = findIngredientInLookup(
          ingredientLookup,
          item.ingredient_id,
        );
        if (ingredient?.name) {
          return ingredient.name;
        }
      }
      return `Stored item #${item.id}`;
    },
    [foodLookup, ingredientLookup],
  );

  const resolveLogLabel = useCallback(
    (entry: DailyLogEntry): string => {
      if (entry.stored_food_id != null) {
        const stored = fridgeInventory.find(
          (item) => item.id === entry.stored_food_id,
        );
        if (stored) {
          return resolveDisplayName(stored);
        }
      }
      if (entry.food_id != null) {
        const food = foodLookup.get(String(entry.food_id));
        if (food?.name) {
          return food.name;
        }
      }
      if (entry.ingredient_id != null) {
        const ingredient = findIngredientInLookup(
          ingredientLookup,
          entry.ingredient_id,
        );
        if (ingredient?.name) {
          return ingredient.name;
        }
      }
      if (entry.log_date) {
        return `Entry from ${formatIsoDate(entry.log_date)}`;
      }
      return `Log entry #${entry.id}`;
    },
    [fridgeInventory, resolveDisplayName, foodLookup, ingredientLookup],
  );

  const handleLogItem = useCallback(
    async (item: CookedBatch) => {
      const rawValue = portionsInput[item.id] ?? "1";
      const portions = Number.parseFloat(rawValue);

      if (!Number.isFinite(portions) || portions <= 0) {
        setFeedback({
          severity: "error",
          message: "Enter a positive number of portions to log.",
        });
        return;
      }

      if (portions > item.remaining_portions) {
        setFeedback({
          severity: "error",
          message: "You cannot log more portions than remain in the fridge.",
        });
        return;
      }

      setFeedback(null);
      setPendingId(item.id);
      startRequest();

      try {
        const request = apiClient
          .path(`/api/stored_food/${item.id}/consume`)
          .method("post")
          .create();
        await request({
          body: { portions },
        });

        const displayName = resolveDisplayName(item);
        const macros = computePortionMacros(item, portions);
        const logRequest = apiClient.path("/api/logs/").method("post").create();
        const { data: rawLog } = (await logRequest({
          body: {
            log_date: selectedDate,
            stored_food_id: item.id,
            portions_consumed: portions,
            calories: macros.calories,
            protein: macros.protein,
            carbohydrates: macros.carbs,
            fat: macros.fat,
            fiber: macros.fiber,
          },
        })) as { data: unknown };

        const normalizedLog = normalizeLogEntry(
          (rawLog ?? {}) as Record<string, unknown>,
        );

        setLogsByDate((prev) => {
          const existing = prev[selectedDate] ?? [];
          return {
            ...prev,
            [selectedDate]: [...existing, normalizedLog],
          };
        });

        setPortionsInput((prev) => ({ ...prev, [item.id]: "1" }));
        setFridgeNeedsRefetch(true);
        setFeedback({
          severity: "success",
          message: `Logged ${formatCellNumber(portions)} portion${
            portions === 1 ? "" : "s"
          } of ${displayName}.`,
        });
      } catch (error) {
        console.error("Failed to log consumption", error);
        setFeedback({
          severity: "error",
          message: "Failed to log consumption. Please try again.",
        });
      } finally {
        setPendingId(null);
        endRequest();
      }
    },
    [
      portionsInput,
      startRequest,
      resolveDisplayName,
      selectedDate,
      setFridgeNeedsRefetch,
      endRequest,
      normalizeLogEntry,
    ],
  );

  const appendLogEntry = useCallback(
    (entry: DailyLogEntry) => {
      setLogsByDate((prev) => {
        const existing = prev[selectedDate] ?? [];
        return {
          ...prev,
          [selectedDate]: [...existing, entry],
        };
      });
    },
    [selectedDate],
  );

  const handleLogIngredient = useCallback(async () => {
    if (!selectedIngredient || !canSubmitIngredientLog) {
      setFeedback({
        severity: "error",
        message: "Select an ingredient, unit, and quantity to log.",
      });
      return;
    }

    if (selectedIngredient.id == null) {
      setFeedback({
        severity: "error",
        message: "The selected ingredient is missing an identifier.",
      });
      return;
    }

    setFeedback(null);
    setPendingIngredientLog(true);
    startRequest();

    try {
      const request = apiClient.path("/api/logs/").method("post").create();
      const { data: rawLog } = (await request({
        body: {
          log_date: selectedDate,
          ingredient_id: selectedIngredient.id,
          stored_food_id: null,
          food_id: null,
          portions_consumed: ingredientGrams,
          calories: ingredientMacros.calories,
          protein: ingredientMacros.protein,
          carbohydrates: ingredientMacros.carbs,
          fat: ingredientMacros.fat,
          fiber: ingredientMacros.fiber,
        },
      })) as { data: unknown };

      const normalizedLog = normalizeLogEntry(
        (rawLog ?? {}) as Record<string, unknown>,
      );
      appendLogEntry(normalizedLog);

      const unitName = selectedIngredientUnit?.name?.trim();
      const unitLabel = unitName && unitName.length > 0 ? unitName : "units";
      setFeedback({
        severity: "success",
        message: `Logged ${formatCellNumber(ingredientQuantityValue)} ${unitLabel} of ${
          selectedIngredient.name ?? "the ingredient"
        }.`,
      });
    } catch (error) {
      console.error("Failed to log ingredient", error);
      setFeedback({
        severity: "error",
        message: "Failed to log the ingredient. Please try again.",
      });
    } finally {
      setPendingIngredientLog(false);
      endRequest();
    }
  }, [
    selectedIngredient,
    canSubmitIngredientLog,
    selectedDate,
    ingredientGrams,
    ingredientMacros,
    normalizeLogEntry,
    appendLogEntry,
    selectedIngredientUnit,
    ingredientQuantityValue,
    startRequest,
    endRequest,
  ]);

  const handleLogFood = useCallback(async () => {
    if (!selectedFood || !canSubmitFoodLog) {
      setFeedback({
        severity: "error",
        message: "Select a food and enter the number of servings to log.",
      });
      return;
    }

    if (selectedFood.id == null) {
      setFeedback({
        severity: "error",
        message: "The selected food is missing an identifier.",
      });
      return;
    }

    setFeedback(null);
    setPendingFoodLog(true);
    startRequest();

    try {
      const request = apiClient.path("/api/logs/").method("post").create();
      const { data: rawLog } = (await request({
        body: {
          log_date: selectedDate,
          food_id: selectedFood.id,
          stored_food_id: null,
          ingredient_id: null,
          portions_consumed: foodPortionValue,
          calories: foodLogMacros.calories,
          protein: foodLogMacros.protein,
          carbohydrates: foodLogMacros.carbs,
          fat: foodLogMacros.fat,
          fiber: foodLogMacros.fiber,
        },
      })) as { data: unknown };

      const normalizedLog = normalizeLogEntry(
        (rawLog ?? {}) as Record<string, unknown>,
      );
      appendLogEntry(normalizedLog);

      setFeedback({
        severity: "success",
        message: `Logged ${formatCellNumber(foodPortionValue)} serving${
          foodPortionValue === 1 ? "" : "s"
        } of ${selectedFood.name ?? "the food"}.`,
      });
    } catch (error) {
      console.error("Failed to log food", error);
      setFeedback({
        severity: "error",
        message: "Failed to log the food. Please try again.",
      });
    } finally {
      setPendingFoodLog(false);
      endRequest();
    }
  }, [
    selectedFood,
    canSubmitFoodLog,
    selectedDate,
    foodPortionValue,
    foodLogMacros,
    normalizeLogEntry,
    appendLogEntry,
    startRequest,
    endRequest,
  ]);

  const handleRemoveStoredItem = useCallback(
    async (item: CookedBatch) => {
      const displayName = resolveDisplayName(item);
      setFeedback(null);
      setRemovingStoredId(item.id);
      startRequest();

      try {
        const request = apiClient
          .path(`/api/stored_food/${item.id}`)
          .method("delete")
          .create();
        await request({});

        setFridgeNeedsRefetch(true);
        setPortionsInput((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        setFeedback({
          severity: "success",
          message: `Removed ${displayName} from the fridge.`,
        });
      } catch (error) {
        console.error("Failed to remove stored food", error);
        setFeedback({
          severity: "error",
          message: "Failed to remove the item from the fridge. Please try again.",
        });
      } finally {
        setRemovingStoredId(null);
        endRequest();
      }
    },
    [resolveDisplayName, startRequest, setFridgeNeedsRefetch, endRequest],
  );

  const handleRemoveLogEntry = useCallback(
    async (entryId: number, label: string) => {
      setFeedback(null);
      setRemovingLogId(entryId);
      startRequest();

      try {
        const request = apiClient
          .path(`/api/logs/${entryId}`)
          .method("delete")
          .create();
        await request({});

        setLogsByDate((prev) => {
          const nextEntries: DailyLogEntryMap = {};
          Object.entries(prev).forEach(([dateKey, entries]) => {
            const filtered = entries.filter((entry) => entry.id !== entryId);
            if (filtered.length > 0) {
              nextEntries[dateKey] = filtered;
            }
          });
          return nextEntries;
        });

        setFeedback({
          severity: "success",
          message: `Removed ${label} from the log.`,
        });
      } catch (error) {
        console.error("Failed to remove log entry", error);
        setFeedback({
          severity: "error",
          message: "Failed to remove the log entry. Please try again.",
        });
      } finally {
        setRemovingLogId(null);
        endRequest();
      }
    },
    [startRequest, endRequest],
  );

  const displayLogsByDate = useMemo(() => {
    const mapped: Record<string, LoggedEntry[]> = {};
    Object.entries(logsByDate).forEach(([dateKey, entries]) => {
      mapped[dateKey] = entries.map((entry) => {
        const macros: MacroTotals = {
          calories: entry.calories,
          protein: entry.protein,
          fat: entry.fat,
          carbs: entry.carbohydrates,
          fiber: entry.fiber,
        };
        const sourceId =
          entry.stored_food_id ??
          entry.ingredient_id ??
          entry.food_id ??
          entry.id;
        return {
          id: entry.id,
          sourceId,
          label: resolveLogLabel(entry),
          portions: entry.portions_consumed,
          macros,
        } satisfies LoggedEntry;
      });
    });
    return mapped;
  }, [logsByDate, resolveLogLabel]);

  const sortedLogDates = useMemo(() => {
    return Object.keys(displayLogsByDate).sort((a, b) => (a > b ? -1 : 1));
  }, [displayLogsByDate]);

  return (
    <Stack spacing={3} sx={{ width: "100%" }}>
      <Typography variant="h4" component="h1">
        Food Logging
      </Typography>

      <Box sx={{ maxWidth: 260 }}>
        <TextField
          label="Log date"
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          fullWidth
        />
      </Box>

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={3}
        sx={{ alignItems: { xs: "stretch", md: "flex-start" } }}
      >
        <Card sx={{ flex: 1, minWidth: 0 }}>
          <CardHeader
            title="Daily Log"
          />
          <CardContent>
            {sortedLogDates.length === 0 ? (
              <Typography color="text.secondary">
                No items have been logged yet. Log items to see them here.
              </Typography>
            ) : (
              <Stack spacing={3}>
                {sortedLogDates.map((dateKey) => {
                  const entries = displayLogsByDate[dateKey] ?? [];
                  const totals = sumMacroTotals(entries.map((entry) => entry.macros));
                  const totalPortions = entries.reduce(
                    (total, entry) => total + entry.portions,
                    0,
                  );
                  const summaryId = `${dateKey}-daily-total`;
                  const summaryMetrics = [
                    {
                      label: "Portions",
                      value: formatCellNumber(totalPortions),
                      ariaLabel: "Total portions",
                    },
                    {
                      label: "Calories",
                      value: formatCellNumber(totals.calories),
                      ariaLabel: "Total calories",
                    },
                    {
                      label: "Protein",
                      value: formatCellNumber(totals.protein),
                      ariaLabel: "Total protein",
                    },
                    {
                      label: "Carbs",
                      value: formatCellNumber(totals.carbs),
                      ariaLabel: "Total carbs",
                    },
                    {
                      label: "Fat",
                      value: formatCellNumber(totals.fat),
                      ariaLabel: "Total fat",
                    },
                    {
                      label: "Fiber",
                      value: formatCellNumber(totals.fiber),
                      ariaLabel: "Total fiber",
                    },
                  ];
                  return (
                    <Box key={dateKey}>
                      <Stack spacing={2}>
                        <Typography variant="h6" component="h3">
                          {formatIsoDate(dateKey)}
                        </Typography>
                        <Paper
                          role="group"
                          aria-labelledby={summaryId}
                          variant="outlined"
                          sx={{
                            p: 2,
                            borderWidth: 2,
                            borderColor: (theme) => theme.palette.primary.light,
                            bgcolor: (theme) =>
                              alpha(theme.palette.primary.light, 0.12),
                          }}
                        >
                          <Stack spacing={2}>
                            <Typography
                              id={summaryId}
                              variant="subtitle1"
                              sx={{ fontWeight: 600 }}
                            >
                              Daily Total
                            </Typography>
                            <Grid container spacing={2}>
                              {summaryMetrics.map((metric) => (
                                <Grid
                                  key={metric.label}
                                  size={{ xs: 6, sm: 4, md: 3, lg: 2 }}
                                >
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ textTransform: "uppercase" }}
                                  >
                                    {metric.label}
                                  </Typography>
                                  <Typography
                                    variant="h6"
                                    component="p"
                                    aria-label={metric.ariaLabel}
                                  >
                                    {metric.value}
                                  </Typography>
                                </Grid>
                              ))}
                            </Grid>
                          </Stack>
                        </Paper>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Item</TableCell>
                              <TableCell align="right">Portions</TableCell>
                              <TableCell align="right">Calories</TableCell>
                              <TableCell align="right">Protein</TableCell>
                              <TableCell align="right">Carbs</TableCell>
                              <TableCell align="right">Fat</TableCell>
                              <TableCell align="right">Fiber</TableCell>
                              <TableCell align="right">Actions</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {entries.map((entry) => (
                              <TableRow key={entry.id}>
                                <TableCell>{entry.label}</TableCell>
                                <TableCell align="right">
                                  {formatCellNumber(entry.portions)}
                                </TableCell>
                                <TableCell align="right">
                                  {formatCellNumber(entry.macros.calories)}
                                </TableCell>
                                <TableCell align="right">
                                  {formatCellNumber(entry.macros.protein)}
                                </TableCell>
                                <TableCell align="right">
                                  {formatCellNumber(entry.macros.carbs)}
                                </TableCell>
                                <TableCell align="right">
                                  {formatCellNumber(entry.macros.fat)}
                                </TableCell>
                                <TableCell align="right">
                                  {formatCellNumber(entry.macros.fiber)}
                                </TableCell>
                                <TableCell align="right">
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    color="error"
                                    onClick={() =>
                                      handleRemoveLogEntry(entry.id, entry.label)
                                    }
                                    disabled={removingLogId === entry.id}
                                  >
                                    {removingLogId === entry.id ? "Removing..." : "Remove"}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Stack spacing={3} sx={{ flex: 1, minWidth: 0 }}>
          <Card>
            <CardHeader
              title="Quick Log"
              subheader="Log ingredients or foods without storing them first"
            />
            <CardContent>
              {hydrating ? (
                <Stack sx={{ py: 4, alignItems: "center", justifyContent: "center" }}>
                  <CircularProgress aria-label="Loading quick log data" />
                </Stack>
              ) : (
                <Stack spacing={3}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    sx={{ alignItems: { xs: "stretch", sm: "center" } }}
                  >
                    <Button
                      variant={activeLogType === "ingredient" ? "contained" : "outlined"}
                      startIcon={<AddIcon />}
                      onClick={() => {
                        setActiveLogType("ingredient");
                        setIngredientPickerOpen(true);
                      }}
                      disabled={hydrating || ingredients.length === 0}
                    >
                      Add Ingredient
                    </Button>
                    <Button
                      variant={activeLogType === "food" ? "contained" : "outlined"}
                      startIcon={<AddIcon />}
                      onClick={() => {
                        setActiveLogType("food");
                        setFoodPickerOpen(true);
                      }}
                      disabled={hydrating || foods.length === 0}
                    >
                      Add Food
                    </Button>
                  </Stack>

                  {activeLogType === "ingredient" && (
                    <Box>
                      <Stack spacing={2}>
                        <Typography
                          variant="body2"
                          color={
                            selectedIngredient ? "text.primary" : "text.secondary"
                          }
                        >
                          {selectedIngredient
                            ? selectedIngredient.name
                            : ingredients.length === 0 && !hydrating
                              ? "No ingredients available"
                              : "No ingredient selected. Use the Add Ingredient button above."}
                        </Typography>
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                          <TextField
                            select
                            label="Unit"
                            fullWidth
                            value={ingredientLog.unitId}
                            onChange={(event) =>
                              setIngredientLog((prev) => ({
                                ...prev,
                                unitId: event.target.value,
                              }))
                            }
                            disabled={!selectedIngredient}
                          >
                            {(selectedIngredient?.units ?? []).map((unit, index) => (
                              <MenuItem
                                key={
                                  unit?.id ?? `${unit?.name ?? "unit"}-${index}`
                                }
                                value={unit?.id == null ? "" : String(unit.id)}
                              >
                                {unit?.name ?? "Unit"}
                              </MenuItem>
                            ))}
                            {(selectedIngredient?.units ?? []).length === 0 && (
                              <MenuItem value="" disabled>
                                No units available
                              </MenuItem>
                            )}
                          </TextField>
                          <TextField
                            label="Quantity"
                            type="number"
                            slotProps={{ htmlInput: { min: 0, step: "any" } }}
                            fullWidth
                            value={ingredientLog.quantity}
                            onChange={(event) =>
                              setIngredientLog((prev) => ({
                                ...prev,
                                quantity: event.target.value,
                              }))
                            }
                            disabled={!selectedIngredient}
                          />
                        </Stack>
                        {selectedIngredient && (
                          <Stack spacing={0.5}>
                            <Typography variant="body2" color="text.secondary">
                              Estimated total: {formatCellNumber(ingredientMacros.calories)} cal, {" "}
                              {formatCellNumber(ingredientMacros.protein)} g protein, {" "}
                              {formatCellNumber(ingredientMacros.carbs)} g carbs, {" "}
                              {formatCellNumber(ingredientMacros.fat)} g fat, {" "}
                              {formatCellNumber(ingredientMacros.fiber)} g fiber
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Approximate weight: {formatCellNumber(ingredientGrams)} g
                            </Typography>
                          </Stack>
                        )}
                        <Button
                          variant="contained"
                          onClick={handleLogIngredient}
                          disabled={pendingIngredientLog || !canSubmitIngredientLog}
                        >
                          {pendingIngredientLog ? "Logging..." : "Log ingredient"}
                        </Button>
                      </Stack>
                    </Box>
                  )}

                  {activeLogType === "food" && (
                    <Box>
                      <Stack spacing={2}>
                        <Typography
                          variant="body2"
                          color={selectedFood ? "text.primary" : "text.secondary"}
                        >
                          {selectedFood
                            ? selectedFood.name ?? ""
                            : foods.length === 0 && !hydrating
                              ? "No foods available"
                              : "No food selected. Use the Add Food button above."}
                        </Typography>
                        <TextField
                          label="Servings"
                          type="number"
                          slotProps={{ htmlInput: { min: 0, step: "any" } }}
                          fullWidth
                          value={foodLog.portions}
                          onChange={(event) =>
                            setFoodLog((prev) => ({
                              ...prev,
                              portions: event.target.value,
                            }))
                          }
                          disabled={!selectedFood}
                        />
                        {selectedFood && (
                          <Stack spacing={0.5}>
                            <Typography variant="body2" color="text.secondary">
                              Estimated per serving: {formatCellNumber(foodBaseMacros.calories)} cal, {" "}
                              {formatCellNumber(foodBaseMacros.protein)} g protein, {" "}
                              {formatCellNumber(foodBaseMacros.carbs)} g carbs, {" "}
                              {formatCellNumber(foodBaseMacros.fat)} g fat, {" "}
                              {formatCellNumber(foodBaseMacros.fiber)} g fiber
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Logging total: {formatCellNumber(foodLogMacros.calories)} cal, {" "}
                              {formatCellNumber(foodLogMacros.protein)} g protein, {" "}
                              {formatCellNumber(foodLogMacros.carbs)} g carbs, {" "}
                              {formatCellNumber(foodLogMacros.fat)} g fat, {" "}
                              {formatCellNumber(foodLogMacros.fiber)} g fiber
                            </Typography>
                          </Stack>
                        )}
                        <Button
                          variant="contained"
                          onClick={handleLogFood}
                          disabled={pendingFoodLog || !canSubmitFoodLog}
                        >
                          {pendingFoodLog ? "Logging..." : "Log food"}
                        </Button>
                      </Stack>
                    </Box>
                  )}
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              title="Fridge Inventory"
              subheader="Select items to log against your chosen day"
            />
            <CardContent>
              {hydrating ? (
                <Stack sx={{ py: 4, alignItems: "center", justifyContent: "center" }}>
                  <CircularProgress aria-label="Loading fridge inventory" />
                </Stack>
              ) : groupedInventory.length === 0 ? (
                <Typography color="text.secondary">
                  Your fridge is empty. Cook or add items to log consumption.
                </Typography>
              ) : (
                <Stack spacing={3}>
                  {groupedInventory.map((group) => (
                    <Box key={group.key}>
                      <Typography variant="h6" component="h2" gutterBottom>
                        {group.label}
                      </Typography>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Item</TableCell>
                            <TableCell align="right">Remaining portions</TableCell>
                            <TableCell align="right">Log portions</TableCell>
                            <TableCell align="right">Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {group.items.map((item) => {
                            const displayName = resolveDisplayName(item);
                            const isDepleted = item.remaining_portions <= 0;
                            const value = portionsInput[item.id] ?? "1";
                            const preparedDate = item.prepared_at
                              ? new Date(item.prepared_at).toLocaleDateString()
                              : null;
                            return (
                              <TableRow key={item.id} hover>
                                <TableCell>
                                  <Stack spacing={0.5}>
                                    <Typography component="span" fontWeight={600}>
                                      {displayName}
                                    </Typography>
                                    {preparedDate && (
                                      <Typography
                                        component="span"
                                        variant="body2"
                                        color="text.secondary"
                                      >
                                        Prepared {preparedDate}
                                      </Typography>
                                    )}
                                    <Typography component="span" variant="body2" color="text.secondary">
                                      Per portion: {formatCellNumber(item.per_portion_calories)} cal,
                                      {" "}
                                      {formatCellNumber(item.per_portion_protein)} g protein,
                                      {" "}
                                      {formatCellNumber(item.per_portion_carbohydrates)} g carbs,
                                      {" "}
                                      {formatCellNumber(item.per_portion_fat)} g fat,
                                      {" "}
                                      {formatCellNumber(item.per_portion_fiber)} g fiber
                                    </Typography>
                                  </Stack>
                                </TableCell>
                                <TableCell align="right">
                                  {formatCellNumber(item.remaining_portions)}
                                </TableCell>
                                <TableCell align="right">
                                  <TextField
                                    type="text"
                                    size="small"
                                    slotProps={{
                                      htmlInput: {
                                        inputMode: "decimal",
                                        "aria-label": `Portions to log for ${displayName}`,
                                      },
                                    }}
                                    value={value}
                                    onChange={(event) =>
                                      setPortionsInput((prev) => ({
                                        ...prev,
                                        [item.id]: event.target.value,
                                      }))
                                    }
                                    disabled={
                                      isDepleted ||
                                      pendingId === item.id ||
                                      removingStoredId === item.id
                                    }
                                  />
                                </TableCell>
                                <TableCell align="right">
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    sx={{ justifyContent: "flex-end" }}
                                  >
                                    <Button
                                      variant="contained"
                                      size="small"
                                      onClick={() => handleLogItem(item)}
                                      disabled={
                                        isDepleted ||
                                        pendingId === item.id ||
                                        removingStoredId === item.id
                                      }
                                    >
                                      {pendingId === item.id ? "Logging..." : "Add to log"}
                                    </Button>
                                    <Button
                                      variant="outlined"
                                      size="small"
                                      color="error"
                                      onClick={() => handleRemoveStoredItem(item)}
                                      disabled={
                                        removingStoredId === item.id || pendingId === item.id
                                      }
                                    >
                                      {removingStoredId === item.id ? "Removing..." : "Remove"}
                                    </Button>
                                  </Stack>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </Box>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Stack>
      <Dialog
        open={ingredientPickerOpen}
        onClose={() => setIngredientPickerOpen(false)}
        fullWidth
        maxWidth="lg"
        scroll="paper"
      >
        <DialogTitle>Select Ingredient</DialogTitle>
        <IngredientTable
          onIngredientDoubleClick={(ingredient) => {
            handleIngredientSelection(ingredient);
          }}
        />
        <DialogActions>
          <Button onClick={handleOpenIngredientModal}>
            New Ingredient
          </Button>
          <Button onClick={() => setIngredientPickerOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={foodPickerOpen}
        onClose={() => setFoodPickerOpen(false)}
        fullWidth
        maxWidth="lg"
        scroll="paper"
      >
        <FoodTable
          onFoodDoubleClick={(food) => {
            handleFoodSelection(food);
          }}
        />
      </Dialog>

      <IngredientModal
        open={ingredientModalOpen}
        mode="add"
        ingredient={null}
        onClose={handleCloseIngredientModal}
      />

      <FeedbackSnackbar
        snackbar={feedback}
        onClose={handleFeedbackClose}
      />
    </Stack>
  );
}

export default Logging;
