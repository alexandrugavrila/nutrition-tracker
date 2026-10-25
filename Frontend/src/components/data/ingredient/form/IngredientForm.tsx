import React, { useEffect, useCallback, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
} from '@mui/material';

import NameEdit from './NameEdit';
import IngredientFields from './IngredientFields';
import SourceEdit from './SourceEdit';
import UnitEdit from './UnitEdit';
import NutritionEdit from './NutritionEdit';
import TagEdit from './TagEdit';
import { useIngredientForm } from './useIngredientForm';
import { useSessionStorageState } from '@/hooks/useSessionStorageState';
import type { components } from '@/api-types';

type IngredientRead = components['schemas']['IngredientRead'];

type IngredientFormProps = {
  ingredientToEditData?: IngredientRead | null;
};

function IngredientForm({ ingredientToEditData }: IngredientFormProps) {
  const [isOpen, setIsOpen] = useSessionStorageState('ingredient-form-open', false);
  const [openConfirmationDialog, setOpenConfirmationDialog] = useState(false);
  const isInitialRenderRef = useRef(true);
  const previousIsOpenRef = useRef(isOpen);
  const [isEditMode, setIsEditMode] = useSessionStorageState('ingredient-form-edit-mode', false);

  const {
    ingredient,
    error,
    copyForEditing,
    dispatch,
    needsClearForm,
    needsFillForm,
    loadIngredient,
    clearForm,
    acknowledgeClearFlag,
    acknowledgeFillFlag,
    save,
    remove,
    applyUsdaResult,
  } = useIngredientForm();

  const handleClearForm = useCallback(() => {
    clearForm();
    setIsEditMode(false);
    setOpenConfirmationDialog(false);
  }, [clearForm, setIsEditMode, setOpenConfirmationDialog]);

  const handleIngredientAction = useCallback(() => {
    save({
      mode: isEditMode ? 'edit' : 'add',
      onSaved: () => {
        if (!isEditMode) {
          setIsEditMode(false);
        }
      },
    });
  }, [isEditMode, save, setIsEditMode]);

  const handleIngredientDelete = useCallback(() => {
    remove({
      onDeleted: () => {
        handleClearForm();
        setOpenConfirmationDialog(false);
      },
    });
  }, [remove, handleClearForm]);

  useEffect(() => {
    if (isInitialRenderRef.current) {
      isInitialRenderRef.current = false;
      if (!ingredientToEditData) {
        return;
      }
    }

    if (!ingredientToEditData) {
      loadIngredient(null);
      setIsEditMode(false);
      setIsOpen(false);
    } else {
      loadIngredient(ingredientToEditData);
      setIsEditMode(true);
      setIsOpen(true);
    }
  }, [ingredientToEditData, loadIngredient, setIsOpen, setIsEditMode]);

  useEffect(() => {
    if (previousIsOpenRef.current && !isOpen) {
      handleClearForm();
    }
    previousIsOpenRef.current = isOpen;
  }, [isOpen, handleClearForm]);

  useEffect(() => {
    if (needsClearForm) acknowledgeClearFlag();
  }, [needsClearForm, acknowledgeClearFlag]);

  useEffect(() => {
    if (needsFillForm) acknowledgeFillFlag();
  }, [needsFillForm, acknowledgeFillFlag]);

  return (
    <div>
      <Paper>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Button onClick={() => setIsOpen((prev) => !prev)}>
            {isOpen ? 'Close' : 'Add Ingredient'}
          </Button>
        </Box>
        <Collapse in={isOpen}>
          <>
            {error && <Alert severity="error">{error}</Alert>}
            {ingredient.is_shared && (
              <Alert severity="info">
                USDA ingredients are read-only. Make a personal copy to edit.
              </Alert>
            )}
            <IngredientFields
              readOnly={Boolean(ingredient.is_shared || ingredient.source === 'usda')}
            >
              <NameEdit
                ingredient={ingredient}
                dispatch={dispatch}
                needsClearForm={needsClearForm}
              />
            </IngredientFields>
            <IngredientFields readOnly={Boolean(ingredient.is_shared)}>
              <SourceEdit
                ingredient={ingredient}
                dispatch={dispatch}
                applyUsdaResult={applyUsdaResult}
              />
            </IngredientFields>
            <IngredientFields
              readOnly={Boolean(ingredient.is_shared || ingredient.source === 'usda')}
            >
              <UnitEdit
                ingredient={ingredient}
                dispatch={dispatch}
                needsClearForm={needsClearForm}
              />
              <NutritionEdit
                ingredient={ingredient}
                dispatch={dispatch}
                needsClearForm={needsClearForm}
                needsFillForm={needsFillForm}
              />
              <TagEdit
                ingredient={ingredient}
                dispatch={dispatch}
                needsClearForm={needsClearForm}
              />
            </IngredientFields>
            {ingredient.is_shared && (
              <Button onClick={copyForEditing}>Make a personal copy to edit</Button>
            )}

            <Button onClick={handleClearForm}>Clear</Button>
            <Button disabled={Boolean(ingredient.is_shared)} onClick={handleIngredientAction}>
              {isEditMode ? 'Update' : 'Add'}
            </Button>
            {isEditMode && (
              <Button onClick={() => setOpenConfirmationDialog(true)}>
                {ingredient.is_shared ? 'Remove from my ingredients' : 'Delete'}
              </Button>
            )}
          </>
        </Collapse>
      </Paper>

      <Dialog open={openConfirmationDialog} onClose={() => setOpenConfirmationDialog(false)}>
        <DialogTitle>
          {ingredient.is_shared ? 'Remove Ingredient' : 'Delete Ingredient'}
        </DialogTitle>
        <DialogContent>
          <div>
            {ingredient.is_shared
              ? 'Remove this USDA ingredient from your ingredients?'
              : 'Are you sure you want to delete this ingredient?'}
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenConfirmationDialog(false)}>Cancel</Button>
          <Button onClick={handleIngredientDelete}>
            {ingredient.is_shared ? 'Remove' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
export default IngredientForm;
