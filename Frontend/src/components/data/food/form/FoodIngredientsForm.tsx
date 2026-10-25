import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  Alert,
  Button,
  TextField,
  Select,
  MenuItem,
  Dialog,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  Paper,
  TableBody,
  IconButton,
  Stack,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

import { useData } from "@/contexts/DataContext";
import IngredientTable from "@/components/data/ingredient/IngredientTable";
import IngredientModal from "@/components/common/IngredientModal";

import { formatCellNumber } from "@/utils/utils";
import {
  addMacroTotals,
  scaleNutrient,
  UNKNOWN_MACROS,
  createIngredientLookup,
  macrosForIngredientPortion,
  ZERO_MACROS,
  findIngredientInLookup,
} from "@/utils/nutrition";
import type { components } from "@/api-types";

const NULL_UNIT_VALUE = "__NULL_UNIT__";

type IngredientRead = components["schemas"]["IngredientRead"];

function matchUnitById(units, targetId) {
  if (!units || units.length === 0) return undefined;
  const normalizedTarget = Array.isArray(targetId) ? targetId[0] : targetId;
  const comparableTarget =
    normalizedTarget === NULL_UNIT_VALUE || normalizedTarget === "" || normalizedTarget === undefined
      ? null
      : normalizedTarget;
  return units.find((unit) => {
    if (unit.id == null && comparableTarget == null) return true;
    if (unit.id == null || comparableTarget == null) return false;
    return String(unit.id) === String(comparableTarget);
  });
}

function coerceUnitId(units, rawId) {
  const normalizedRaw = Array.isArray(rawId) ? rawId[0] : rawId;
  if (
    normalizedRaw === NULL_UNIT_VALUE ||
    normalizedRaw === "" ||
    normalizedRaw === undefined ||
    normalizedRaw === null
  ) {
    return null;
  }
  const match = matchUnitById(units, normalizedRaw);
  if (!match) return normalizedRaw;
  return match.id ?? null;
}

function FoodIngredientsForm({ food, dispatch, needsClearForm, recipeYield, onRecipeYieldChange, isEditMode }) {
  //#region States
  const { ingredients } = useData();
  const [openIngredientsDialog, setOpenIngredientsDialog] = useState(false);
  const [modalState, setModalState] = useState<{ mode: "add" | "edit"; ingredient: IngredientRead | null } | null>(null);
  const [unitQuantities, setUnitQuantities] = useState({}); // Use an object to track unit quantities by ingredient index
  const [totalMacros, setTotalMacros] = useState(() => ({ ...ZERO_MACROS }));
  const ingredientLookup = useMemo(() => createIngredientLookup(ingredients), [ingredients]);
  //#endregion States

  //#region Handles
  const parsedRecipeYield = useMemo(() => {
    const parsed = parseFloat(recipeYield);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [recipeYield]);

  const perPortionMacros = useMemo(
    () => ({
      calories: scaleNutrient(totalMacros.calories, 1 / parsedRecipeYield),
      protein: scaleNutrient(totalMacros.protein, 1 / parsedRecipeYield),
      fat: scaleNutrient(totalMacros.fat, 1 / parsedRecipeYield),
      carbs: scaleNutrient(totalMacros.carbs, 1 / parsedRecipeYield),
      fiber: scaleNutrient(totalMacros.fiber, 1 / parsedRecipeYield),
    }),
    [parsedRecipeYield, totalMacros],
  );

  const handleRecipeYieldInputChange = useCallback(
    (event) => {
      onRecipeYieldChange(event.target.value);
    },
    [onRecipeYieldChange]
  );

  const handleOpenIngredientsDialog = () => {
    setOpenIngredientsDialog(true);
  };

  const handleCloseIngredientsDialog = () => {
    setOpenIngredientsDialog(false);
  };

  const handleAddIngredient = (ingredient) => {
    dispatch({ type: "SET_FOOD", payload: { ...food, ingredients: [...food.ingredients, buildFoodIngredient(ingredient)] } });
    handleCloseIngredientsDialog();
  };

  const handleRemoveIngredient = useCallback(
    (targetIndex) => {
      const updatedIngredients = food.ingredients.filter((_, ingredientIndex) => ingredientIndex !== targetIndex);
      dispatch({ type: "SET_FOOD", payload: { ...food, ingredients: updatedIngredients } });
      setUnitQuantities(
        updatedIngredients.reduce((acc, ingredient, index) => {
          const quantity = ingredient.unit_quantity;
          acc[index] = quantity != null ? quantity.toString() : "";
          return acc;
        }, /** @type {Record<number, string>} */ ({}))
      );
    },
    [dispatch, food]
  );

  const handleOpenIngredientEditor = (ingredientId) => {
    const dataIngredient = findIngredientInLookup(ingredientLookup, ingredientId) ?? null;
    if (dataIngredient) {
      setModalState({ mode: "edit", ingredient: dataIngredient });
    } else {
      setModalState({ mode: "add", ingredient: null });
    }
  };

  const buildFoodIngredient = (ingredient) => {
    return {
      ingredient_id: ingredient.id,
      food_id: food.id,
      unit_id: ingredient.shoppingUnitId ?? null,
      unit_quantity: 1,
    };
  };

  const handleUnitQuantityChange = (event, index) => {
    const newUnitQuantities = { ...unitQuantities, [index]: event.target.value };
    setUnitQuantities(newUnitQuantities);
    handleUpdateIngredientUnitQuantity(index, event.target.value);
  };

  const handleUnitQuantityBlur = (index) => {
    if (unitQuantities[index] === "") {
      const newUnitQuantities = { ...unitQuantities, [index]: "0" };
      setUnitQuantities(newUnitQuantities);
      handleUpdateIngredientUnitQuantity(index, "0");
    }
  };

  const handleUpdateIngredientUnitQuantity = (index, value) => {
    const updatedIngredients = [...food.ingredients];
    updatedIngredients[index] = {
      ...updatedIngredients[index],
      unit_quantity: parseFloat(value),
    };
    if (!isNaN(updatedIngredients[index].unit_quantity)) {
      // Don't update if the field is empty
      dispatch({ type: "SET_FOOD", payload: { ...food, ingredients: updatedIngredients } });
    }
  };

  const calculateTotalIngredientMacros = useCallback(
    (foodIngredient) => {
      if (!foodIngredient) return { ...ZERO_MACROS };
      const ingredientId = foodIngredient.ingredient_id;
      if (ingredientId === null || ingredientId === undefined) {
        return { ...ZERO_MACROS };
      }
      const dataIngredient = findIngredientInLookup(ingredientLookup, ingredientId);
      if (!dataIngredient) {
        return { ...UNKNOWN_MACROS };
      }
      return macrosForIngredientPortion({
        ingredient: dataIngredient,
        unitId: foodIngredient.unit_id,
        quantity: foodIngredient.unit_quantity,
      });
    },
    [ingredientLookup]
  );

  const handleUnitChange = (event, ingredientIndex, ingredientUnits) => {
    const unitsForIngredient = ingredientUnits ?? [];
    const newUnitId = coerceUnitId(unitsForIngredient, event.target.value);
    const updatedIngredients = [...food.ingredients];
    updatedIngredients[ingredientIndex] = {
      ...updatedIngredients[ingredientIndex],
      unit_id: newUnitId,
    };
    dispatch({ type: "SET_FOOD", payload: { ...food, ingredients: updatedIngredients } });
  };
  //#endregion Handles

  //#region Effects
  useEffect(() => {
    if (needsClearForm) {
      dispatch({ type: "SET_FOOD", payload: { ...food, ingredients: [] } });
    }
  }, [needsClearForm, dispatch, food]); // Clear ingredients when needsClearForm is true

  useEffect(() => {
    const initialUnitQuantities = food.ingredients.reduce((acc, ingredient, index) => {
      acc[index] = ingredient.unit_quantity.toString();
      return acc;
    }, {});
    setUnitQuantities(initialUnitQuantities);
  }, [food]); // Initialize or reset the unit quantities when food changes, ensuring inputs are up-to-date

  useEffect(() => {
    const totals = food.ingredients.reduce(
      (acc, ingredient) => {
        const macros = calculateTotalIngredientMacros(ingredient);
        return addMacroTotals(acc, macros);
      },
      { ...ZERO_MACROS }
    );

    setTotalMacros(totals);
  }, [food.ingredients, calculateTotalIngredientMacros]); // Update totals when food ingredients or ingredients change
  //#endregion Effects

  return (
    <div>
      <Stack spacing={1} sx={{ mb: 2 }}>
        <TextField
          label="Recipe yields"
          type="number"
          value={recipeYield}
          onChange={handleRecipeYieldInputChange}
          disabled={isEditMode}
          inputProps={{ min: 1, step: "any", inputMode: "decimal" }}
          helperText={
            isEditMode
              ? "Existing foods already store ingredient amounts per single portion."
              : "Ingredient amounts will be divided by this number when saved."
          }
        />
        <Alert severity="info">
          {isEditMode
            ? "Adjust ingredient amounts directly to change the per-portion values that are stored."
            : `When you save, each ingredient amount will be divided by ${parsedRecipeYield} so the food is stored per portion. The table below shows the quantities and macros you entered before that division.`}
        </Alert>
      </Stack>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell></TableCell>
              <TableCell></TableCell>
              <TableCell>{formatCellNumber(totalMacros.calories)}</TableCell>
              <TableCell>{formatCellNumber(totalMacros.protein)}</TableCell>
              <TableCell>{formatCellNumber(totalMacros.fat)}</TableCell>
              <TableCell>{formatCellNumber(totalMacros.carbs)}</TableCell>
              <TableCell>{formatCellNumber(totalMacros.fiber)}</TableCell>
            </TableRow>
            {!isEditMode && (
              <TableRow>
                <TableCell>Per portion</TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell>{formatCellNumber(perPortionMacros.calories)}</TableCell>
                <TableCell>{formatCellNumber(perPortionMacros.protein)}</TableCell>
                <TableCell>{formatCellNumber(perPortionMacros.fat)}</TableCell>
                <TableCell>{formatCellNumber(perPortionMacros.carbs)}</TableCell>
                <TableCell>{formatCellNumber(perPortionMacros.fiber)}</TableCell>
              </TableRow>
            )}
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell>Amount</TableCell>
              <TableCell>Calories</TableCell>
              <TableCell>Protein</TableCell>
              <TableCell>Fat</TableCell>
              <TableCell>Carbs</TableCell>
              <TableCell>Fiber</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {food.ingredients.map((ingredient, index) => {
              const dataIngredient = findIngredientInLookup(ingredientLookup, ingredient.ingredient_id);
              const ingredientUnits = dataIngredient?.units ?? [];
              const defaultUnitId =
                ingredientUnits.find((u) => u.grams === 1)?.id ??
                ingredientUnits[0]?.id ??
                null;
              const selectedUnitId = ingredient.unit_id ?? defaultUnitId ?? null;
              const selectedUnitOption =
                selectedUnitId == null ? NULL_UNIT_VALUE : String(selectedUnitId);
              return (
                <TableRow key={index}>
                  <TableCell>{dataIngredient ? dataIngredient.name : "Unknown Ingredient"}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Select
                        style={{ textAlign: "center" }}
                        value={selectedUnitOption}
                        onChange={(event) => handleUnitChange(event, index, ingredientUnits)}
                        inputProps={{ "aria-label": "Without label" }}
                        displayEmpty
                        renderValue={(value) => {
                          const unit = matchUnitById(ingredientUnits, value);
                          return unit ? unit.name : "Select unit";
                        }}>
                        {ingredientUnits.map((unit) => {
                          const optionValue = unit.id == null ? NULL_UNIT_VALUE : String(unit.id);
                          return (
                            <MenuItem key={unit.id ?? `unit-${unit.name}`} value={optionValue}>
                              {unit.name}
                            </MenuItem>
                          );
                        })}
                      </Select>
                      <IconButton
                        aria-label="Edit ingredient"
                        size="small"
                        onClick={() => handleOpenIngredientEditor(ingredient.ingredient_id)}
                        title="Edit ingredient (add units, nutrition, tags)"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        aria-label="Remove ingredient"
                        size="small"
                        onClick={() => handleRemoveIngredient(index)}
                        title="Remove ingredient from food"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <TextField
                      type="number"
                      value={unitQuantities[index] || ""}
                      onChange={(event) => handleUnitQuantityChange(event, index)}
                      onBlur={() => handleUnitQuantityBlur(index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.target.blur();
                      }}
                      inputProps={{ min: 0, step: "any", inputMode: "decimal" }}
                    />
                  </TableCell>
                  <TableCell>{formatCellNumber(calculateTotalIngredientMacros(ingredient).calories)}</TableCell>
                  <TableCell>{formatCellNumber(calculateTotalIngredientMacros(ingredient).protein)}</TableCell>
                  <TableCell>{formatCellNumber(calculateTotalIngredientMacros(ingredient).fat)}</TableCell>
                  <TableCell>{formatCellNumber(calculateTotalIngredientMacros(ingredient).carbs)}</TableCell>
                  <TableCell>{formatCellNumber(calculateTotalIngredientMacros(ingredient).fiber)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button variant="contained" onClick={handleOpenIngredientsDialog}>
          Add Ingredients
        </Button>
        <Button
          variant="outlined"
          onClick={() => {
            setModalState({ mode: "add", ingredient: null });
          }}
        >
          New Ingredient
        </Button>
      </Stack>

      <Dialog
        open={openIngredientsDialog}
        onClose={handleCloseIngredientsDialog}
        maxWidth="lg"
        scroll="body"
        fullWidth>
        <IngredientTable
          onIngredientDoubleClick={handleAddIngredient}
          onIngredientCtrlClick={(ing) => {
            setModalState({ mode: "edit", ingredient: ing });
          }}
        />
      </Dialog>

      <IngredientModal
        open={Boolean(modalState)}
        mode={modalState?.mode ?? "add"}
        ingredient={modalState?.ingredient ?? null}
        onClose={() => setModalState(null)}
      />
    </div>
  );
}

export default FoodIngredientsForm;
