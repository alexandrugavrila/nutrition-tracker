import { scaleNutrient } from "@/utils/nutrition";
import React, { useCallback, useEffect, useState } from "react";
import { TextField, Typography } from "@mui/material";
import { roundNutritionValue } from "@/utils/nutritionPrecision";

function NutritionEdit({ ingredient, dispatch, needsClearForm, needsFillForm }) {
  const [multiplier, setMultiplier] = useState(1);
  const [displayNutrition, setDisplayedNutrition] = useState<Record<string, number | string | null>>({
    calories: null,
    protein: null,
    carbohydrates: null,
    fat: null,
    fiber: null,
  });
  const isUsdaSource = ingredient?.source === "usda";

  const inputStyle = {
    width: "15ch",
    margin: "8px",
    "& input": {
      marginLeft: "3ch",
    },
  };

  const handleFieldEdit = (key, value) => {
    // Allow empty, integers, and decimals while typing (e.g. "1.")
    const isValidPartialNumber = value === "" || /^(\d+)?([.,]\d*)?$/.test(value);
    if (!isValidPartialNumber) {
      return;
    }

    setDisplayedNutrition({
      ...displayNutrition,
      [key]: value,
    });
  };
  const getRoundedDisplayNutrition = useCallback(
    (targetMultiplier: number) => ({
      calories: roundNutritionValue(scaleNutrient(ingredient?.nutrition?.calories, targetMultiplier)),
      protein: roundNutritionValue(scaleNutrient(ingredient?.nutrition?.protein, targetMultiplier)),
      carbohydrates: roundNutritionValue(scaleNutrient(ingredient?.nutrition?.carbohydrates, targetMultiplier)),
      fat: roundNutritionValue(scaleNutrient(ingredient?.nutrition?.fat, targetMultiplier)),
      fiber: roundNutritionValue(scaleNutrient(ingredient?.nutrition?.fiber, targetMultiplier)),
    }),
    [ingredient],
  );

  const handleFieldEditFinish = () => {
    // Normalize blanks and parse to numbers (support ',' as decimal)
    const normalized = Object.keys(displayNutrition).reduce((acc, key) => {
      const raw = displayNutrition[key];
      const parsed = parseFloat(String(raw).replace(",", "."));
      const numericValue = Number.isNaN(parsed) ? null : roundNutritionValue(parsed);
      return { ...acc, [key]: numericValue };
    }, {});

    setDisplayedNutrition(normalized);

    // Calculate nutrition per gram
    const baseMultiplier = multiplier || 1;
    const updatedNutrition = {
      calories: scaleNutrient(normalized.calories, 1 / baseMultiplier),
      protein: scaleNutrient(normalized.protein, 1 / baseMultiplier),
      carbohydrates: scaleNutrient(normalized.carbohydrates, 1 / baseMultiplier),
      fat: scaleNutrient(normalized.fat, 1 / baseMultiplier),
      fiber: scaleNutrient(normalized.fiber, 1 / baseMultiplier),
    };
    dispatch({ type: "SET_INGREDIENT", payload: { ...ingredient, nutrition: updatedNutrition } });
  };

  useEffect(() => {
    if (!ingredient) return;

    const units = ingredient.units || [];
    const selectedUnit =
      units.find((unit) => {
        const target = ingredient.shoppingUnitId;
        if (target == null) return false;
        if (unit.id == null) return false;
        if (typeof target === "string" && !Number.isNaN(Number(target))) {
          return Number(unit.id) === Number(target);
        }
        return String(unit.id) === String(target);
      }) || units[0];
    const parsedGrams = parseFloat(String(selectedUnit?.grams ?? 1));
    const safeMultiplier = Number.isFinite(parsedGrams) && parsedGrams > 0 ? parsedGrams : 1;

    if (safeMultiplier !== multiplier) {
      setMultiplier(safeMultiplier);
    }

    if (!needsClearForm) {
      setDisplayedNutrition(getRoundedDisplayNutrition(safeMultiplier));
    }
  }, [ingredient, multiplier, needsClearForm, getRoundedDisplayNutrition]); // Sync displayed nutrition when units or base values change

  useEffect(() => {
    if (needsClearForm) {
      // Clear input fields visually
      setDisplayedNutrition({
        calories: "",
        protein: "",
        carbohydrates: "",
        fat: "",
        fiber: "",
      });

      // Blank nutrient inputs represent unavailable values.
      const clearedNutrition = {
        calories: null,
        protein: null,
        carbohydrates: null,
        fat: null,
        fiber: null,
      };
      dispatch({ type: "SET_INGREDIENT", payload: { ...ingredient, nutrition: clearedNutrition } });
    }
  }, [needsClearForm, dispatch, ingredient]); // Clears the form on needsClearForm

  useEffect(() => {
    if (needsFillForm) {
      setDisplayedNutrition(getRoundedDisplayNutrition(multiplier));
    }
  }, [needsFillForm, ingredient, multiplier, getRoundedDisplayNutrition]); // Fills the form on needsFillForm

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
      <Typography variant="caption">Blank nutrients are unavailable; incomplete totals remain unavailable.</Typography>
      {isUsdaSource && (
        <Typography variant="caption" color="text.secondary" sx={{ mx: 1 }}>
          USDA-sourced nutrition is read-only.
        </Typography>
      )}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
      <TextField
        label="Calories"
        value={displayNutrition.calories ?? ""}
        onChange={(e) => handleFieldEdit("calories", e.target.value)}
        onBlur={handleFieldEditFinish}
        variant="outlined"
        sx={inputStyle}
        disabled={isUsdaSource}
        inputProps={{
          sx: inputStyle["& input"],
          inputMode: "decimal",
        }}
      />
      <TextField
        label="Protein"
        value={displayNutrition.protein ?? ""}
        onChange={(e) => handleFieldEdit("protein", e.target.value)}
        onBlur={handleFieldEditFinish}
        variant="outlined"
        sx={inputStyle}
        disabled={isUsdaSource}
        inputProps={{
          sx: inputStyle["& input"],
          inputMode: "decimal",
        }}
      />
      <TextField
        label="Carbs"
        value={displayNutrition.carbohydrates ?? ""}
        onChange={(e) => handleFieldEdit("carbohydrates", e.target.value)}
        onBlur={handleFieldEditFinish}
        variant="outlined"
        sx={inputStyle}
        disabled={isUsdaSource}
        inputProps={{
          sx: inputStyle["& input"],
          inputMode: "decimal",
        }}
      />
      <TextField
        label="Fat"
        value={displayNutrition.fat ?? ""}
        onChange={(e) => handleFieldEdit("fat", e.target.value)}
        onBlur={handleFieldEditFinish}
        variant="outlined"
        sx={inputStyle}
        disabled={isUsdaSource}
        inputProps={{
          sx: inputStyle["& input"],
          inputMode: "decimal",
        }}
      />
      <TextField
        label="Fiber"
        value={displayNutrition.fiber ?? ""}
        onChange={(e) => handleFieldEdit("fiber", e.target.value)}
        onBlur={handleFieldEditFinish}
        variant="outlined"
        sx={inputStyle}
        disabled={isUsdaSource}
        inputProps={{
          sx: inputStyle["& input"],
          inputMode: "decimal",
        }}
      />
      </div>
    </div>
  );
}

export default NutritionEdit;


