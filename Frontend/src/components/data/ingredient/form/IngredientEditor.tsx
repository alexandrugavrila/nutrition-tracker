import React, { useEffect } from 'react';
import { Alert, Box, Button, Divider } from '@mui/material';

import NameEdit from './NameEdit';
import IngredientFields from './IngredientFields';
import SourceEdit from './SourceEdit';
import UnitEdit from './UnitEdit';
import NutritionEdit from './NutritionEdit';
import TagEdit from './TagEdit';
import { useIngredientForm } from './useIngredientForm';
import type { components } from '@/api-types';

type IngredientRead = components['schemas']['IngredientRead'];

type IngredientEditorProps = {
  mode: 'add' | 'edit';
  initial?: IngredientRead | null;
  onSaved?: () => void;
  onDeleted?: () => void;
};

/**
 * A focused Ingredient editor meant for embedding in a Drawer/Modal.
 * Reuses the same sub-editors as the collapsible IngredientForm, but
 * leaves layout and open/close to the parent.
 */
function IngredientEditor({ mode, initial = null, onSaved, onDeleted }: IngredientEditorProps) {
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

  useEffect(() => {
    loadIngredient(initial ?? null);
  }, [initial, loadIngredient]);

  useEffect(() => {
    if (needsClearForm) acknowledgeClearFlag();
  }, [needsClearForm, acknowledgeClearFlag]);

  useEffect(() => {
    if (needsFillForm) acknowledgeFillFlag();
  }, [needsFillForm, acknowledgeFillFlag]);

  const handleSave = () => {
    save({ mode, onSaved });
  };

  const handleDelete = () => {
    if (mode !== 'edit') return;
    remove({ onDeleted });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {error && <Alert severity="error">{error}</Alert>}
      {ingredient.is_shared && (
        <Alert severity="info">USDA ingredients are read-only. Make a personal copy to edit.</Alert>
      )}
      <IngredientFields readOnly={Boolean(ingredient.is_shared || ingredient.source === 'usda')}>
        <NameEdit ingredient={ingredient} dispatch={dispatch} needsClearForm={needsClearForm} />
      </IngredientFields>
      <IngredientFields readOnly={Boolean(ingredient.is_shared)}>
        <SourceEdit ingredient={ingredient} dispatch={dispatch} applyUsdaResult={applyUsdaResult} />
      </IngredientFields>
      <IngredientFields readOnly={Boolean(ingredient.is_shared || ingredient.source === 'usda')}>
        <UnitEdit ingredient={ingredient} dispatch={dispatch} needsClearForm={needsClearForm} />
        <NutritionEdit
          ingredient={ingredient}
          dispatch={dispatch}
          needsClearForm={needsClearForm}
          needsFillForm={needsFillForm}
        />
        <TagEdit ingredient={ingredient} dispatch={dispatch} needsClearForm={needsClearForm} />
      </IngredientFields>
      {ingredient.is_shared && (
        <Button onClick={copyForEditing}>Make a personal copy to edit</Button>
      )}

      <Divider sx={{ my: 1 }} />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button aria-label="clear ingredient form" onClick={clearForm}>
          Clear
        </Button>
        <Button
          disabled={Boolean(ingredient.is_shared)}
          aria-label={mode === 'edit' ? 'update ingredient' : 'add ingredient'}
          variant="contained"
          onClick={handleSave}
        >
          {mode === 'edit' ? 'Update' : 'Add'}
        </Button>
        {mode === 'edit' && (
          <Button aria-label="delete ingredient" color="error" onClick={handleDelete}>
            {ingredient.is_shared ? 'Remove from my ingredients' : 'Delete'}
          </Button>
        )}
      </Box>
    </Box>
  );
}

export default IngredientEditor;
