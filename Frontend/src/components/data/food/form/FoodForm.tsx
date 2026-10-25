import { useAccountFetch } from "@/contexts/AccountScope";
// @ts-check
import React, { useEffect, useCallback, useRef } from "react";
import { Button, Collapse, Paper, Dialog, DialogTitle, DialogContent, DialogActions } from "@mui/material";
import { useSessionStorageReducer } from "@/hooks/useSessionStorageState";

import { useData } from "@/contexts/DataContext";
import { generateUUID, handleFetchRequest } from "@/utils/utils";

import FoodNameForm from "./FoodNameForm";
import FoodIngredientsForm from "./FoodIngredientsForm";

/**
 * @typedef {import("../../../../api-types").operations["add_food_api_foods_post"]["requestBody"]["content"]["application/json"]} FoodRequest
 * @typedef {import("../../../../api-types").operations["add_food_api_foods_post"]["responses"][201]["content"]["application/json"]} FoodResponse
 */

const createEmptyFood = () => ({
  name: "",
  id: generateUUID(),
  ingredients: [],
  tags: [],
});

const createInitialState = () => ({
  isOpen: false,
  openConfirmationDialog: false,
  isEditMode: false,
  foodToEdit: createEmptyFood(),
  needsClearForm: false,
  needsFillForm: false,
  recipeYield: "1",
});

const reducer = (state, action) => {
  switch (action.type) {
    case "OPEN_FORM":
      return { ...state, isOpen: action.payload };
    case "SET_EDIT_MODE":
      return { ...state, isEditMode: action.payload };
    case "SET_FOOD":
      return { ...state, foodToEdit: action.payload };
    case "SET_CLEAR_FORM":
      return { ...state, needsClearForm: action.payload };
    case "SET_FILL_FORM":
      return { ...state, needsFillForm: action.payload };
    case "SET_CONFIRMATION_DIALOG":
      return { ...state, openConfirmationDialog: action.payload };
    case "SET_RECIPE_YIELD":
      return { ...state, recipeYield: action.payload };
    case "UPDATE_UNIT_QUANTITY": {
      const updatedIngredients = [...state.foodToEdit.ingredients];
      updatedIngredients[action.payload.index].unit_quantity = action.payload.unit_quantity;
      return { ...state, foodToEdit: { ...state.foodToEdit, ingredients: updatedIngredients } };
    }
    default:
      return state;
  }
};

function FoodForm({ foodToEditData }) {
  const fetch = useAccountFetch();
  //#region States
  const { setFoodsNeedsRefetch, startRequest, endRequest } = useData();
  const [state, dispatch] = useSessionStorageReducer(reducer, createInitialState, "food-form-state-v1");

  const { isOpen, openConfirmationDialog, isEditMode, foodToEdit, needsClearForm, needsFillForm, recipeYield } = state;
  const isInitialRenderRef = useRef(true);
  const previousIsOpenRef = useRef(isOpen);

  //#endregion States

  //#region Handlers
  const handleClearForm = useCallback(() => {
    dispatch({ type: "SET_EDIT_MODE", payload: false });
    dispatch({ type: "SET_FOOD", payload: createEmptyFood() });
    dispatch({ type: "SET_CLEAR_FORM", payload: true });
    dispatch({ type: "SET_RECIPE_YIELD", payload: "1" });
  }, [dispatch]);

  const handleRecipeYieldChange = useCallback(
    (value) => {
      dispatch({ type: "SET_RECIPE_YIELD", payload: value });
    },
    [dispatch]
  );

  const handleFoodAction = () => {
    startRequest();

    const toDatabaseFood = buildFoodPayload(foodToEdit);

    const url = isEditMode ? `/api/foods/${foodToEdit.id}` : "/api/foods/";
    const method = isEditMode ? "PUT" : "POST";

    handleFetchRequest(url, method, /** @type {FoodRequest} */ (toDatabaseFood), fetch)
      .then(() => {
        setFoodsNeedsRefetch(true);
        if (!isEditMode) {
          handleClearForm();
        }
      })
      .catch((error) => {
        console.error("Error:", error);
      })
      .finally(endRequest);
  };

  const buildFoodPayload = (food) => {
    const parsedYield = parseFloat(recipeYield);
    const normalizedYield = Number.isFinite(parsedYield) && parsedYield > 0 ? parsedYield : 1;
    const normalizationFactor = isEditMode ? 1 : normalizedYield;

    return {
      name: food.name,
      ingredients: food.ingredients
        .filter(
          ({ ingredient_id, unit_id }) => typeof ingredient_id === "number" && (unit_id === null || typeof unit_id === "number")
        )
        .map(({ ingredient_id, unit_id, unit_quantity }) => {
          const numericQuantity = Number(unit_quantity);
          const safeQuantity = Number.isFinite(numericQuantity) ? numericQuantity : 0;
          const normalizedQuantity = normalizationFactor === 1 ? safeQuantity : safeQuantity / normalizationFactor;

          return {
            ingredient_id,
            // Normalize synthetic 1g selection (id 0) to null for DB
            unit_id: unit_id === 0 ? null : unit_id,
            unit_quantity: normalizedQuantity,
          };
        }),
      tags: (food.tags || [])
        .filter((tag) => typeof tag.id === "number")
        .map((tag) => ({ id: tag.id })),
    };
  };

  const handleFoodDelete = () => {
    if (foodToEdit) {
      startRequest();
      fetch(`/api/foods/${foodToEdit.id}`, {
        method: "DELETE",
      })
        .then((response) => {
          /** @type {Promise<FoodResponse>} */ (response.json());
          if (response.ok) {
            setFoodsNeedsRefetch(true);
            handleClearForm();
          } else {
            console.error("Failed to remove food");
          }
        })
        .catch((error) => {
          console.error("Error:", error);
        })
        .finally(() => {
          endRequest();
          handleCloseConfirmationDialog();
        });
    }
  };

  const handleCloseConfirmationDialog = () => {
    dispatch({ type: "SET_CONFIRMATION_DIALOG", payload: false });
  };
  //#endregion Handlers

  //#region Effects
  useEffect(() => {
    if (isInitialRenderRef.current) {
      isInitialRenderRef.current = false;
      if (!foodToEditData) {
        return;
      }
    }

    if (!foodToEditData) {
      dispatch({ type: "SET_FOOD", payload: createEmptyFood() });
      dispatch({ type: "SET_EDIT_MODE", payload: false });
      dispatch({ type: "OPEN_FORM", payload: false });
    } else {
      dispatch({ type: "SET_FOOD", payload: { ...foodToEditData } });
      dispatch({ type: "SET_EDIT_MODE", payload: true });
      dispatch({ type: "OPEN_FORM", payload: true });
      dispatch({ type: "SET_FILL_FORM", payload: true });
      dispatch({ type: "SET_RECIPE_YIELD", payload: "1" });
    }
  }, [foodToEditData, dispatch]); // Fill foodToEdit and set form state when foodToEditData changes

  useEffect(() => {
    if (previousIsOpenRef.current && !isOpen) {
      handleClearForm();
    }
    previousIsOpenRef.current = isOpen;
  }, [isOpen, handleClearForm]); // Clear form when closing form

  useEffect(() => {
    if (needsClearForm) {
      dispatch({ type: "SET_CLEAR_FORM", payload: false });
    }
  }, [needsClearForm, dispatch]); // Reset needsClearForm flag after it's been used

  useEffect(() => {
    if (needsFillForm) {
      dispatch({ type: "SET_FILL_FORM", payload: false });
    }
  }, [needsFillForm, dispatch]); // Reset needsFillForm flag after it's been used
  //#endregion Effects

  return (
    <div>
      <Paper sx={{ position: "relative" }}>
        <Button
          sx={{ display: "block", mx: "auto" }}
          onClick={() => dispatch({ type: "OPEN_FORM", payload: !isOpen })}
        >
          {isOpen ? "Close" : "Add Food"}
        </Button>
        <Collapse in={isOpen}>
          <>
            <FoodNameForm
              food={foodToEdit}
              dispatch={dispatch}
              needsClearForm={needsClearForm}
            />
            <FoodIngredientsForm
              food={foodToEdit}
              dispatch={dispatch}
              needsClearForm={needsClearForm}
              recipeYield={recipeYield}
              onRecipeYieldChange={handleRecipeYieldChange}
              isEditMode={isEditMode}
            />
          </>

          <Button aria-label="clear food form" onClick={handleClearForm}>Clear</Button>
          <Button aria-label={isEditMode ? "update food" : "add food"} onClick={handleFoodAction}>{isEditMode ? "Update" : "Add"}</Button>
          {isEditMode && <Button aria-label="delete food" onClick={() => dispatch({ type: "SET_CONFIRMATION_DIALOG", payload: true })}>Delete</Button>}
        </Collapse>
      </Paper>

      <Dialog
        open={openConfirmationDialog}
        onClose={handleCloseConfirmationDialog}>
        <DialogTitle>Delete Ingredient</DialogTitle>
        <DialogContent>
          <div>Are you sure you want to delete this ingredient?</div>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseConfirmationDialog}>Cancel</Button>
          <Button onClick={handleFoodDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}

export default FoodForm;
