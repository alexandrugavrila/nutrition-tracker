import { parseNutrient, scaleNutrient } from "@/utils/nutrition";
import { useAccountFetch } from "@/contexts/AccountScope";
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';

import type {
  IngredientSource,
  UsdaIngredientResult,
  UsdaIngredientUnit,
} from './useIngredientForm';
import {
  DEFAULT_USDA_DATA_TYPES,
  getUsdaDataTypeLabel,
  USDA_DATA_TYPE_OPTIONS,
} from './usdaDataTypes';
import type { USDADataType } from './usdaDataTypes';
import { formatNutritionValue } from '@/utils/nutritionPrecision';

const createUsdaUnitKey = (unit: Pick<UsdaIngredientUnit, 'id' | 'name' | 'grams'>): string => {
  if (unit.id !== null && unit.id !== undefined && String(unit.id).trim() !== '') {
    return `id:${String(unit.id)}`;
  }

  return `name:${unit.name.trim().toLowerCase()}|grams:${Number(unit.grams)}`;
};

const mapUsdaUnits = (value: unknown): UsdaIngredientUnit[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();

  return value.reduce<UsdaIngredientUnit[]>((acc, unit) => {
    if (!unit || typeof unit !== 'object') {
      return acc;
    }

    const rawUnit = unit as Record<string, unknown>;
    const name = String(rawUnit.name ?? '').trim();
    const grams = Number(rawUnit.grams);

    if (!name || !Number.isFinite(grams) || grams <= 0) {
      return acc;
    }

    const mappedUnit: UsdaIngredientUnit = {
      id: rawUnit.id as string | number | null | undefined,
      name,
      grams,
      is_default: Boolean(rawUnit.is_default ?? rawUnit.isDefault),
    };
    const key = createUsdaUnitKey(mappedUnit);
    if (seen.has(key)) {
      return acc;
    }

    seen.add(key);
    acc.push(mappedUnit);
    return acc;
  }, []);
};

const getDefaultUnitKey = (units: UsdaIngredientUnit[]): string | null => {
  const defaultUnit = units.find((unit) => unit.is_default) ?? units[0] ?? null;
  return defaultUnit ? createUsdaUnitKey(defaultUnit) : null;
};

const getDefaultUnitLabel = (result: UsdaIngredientResult): string => {
  const defaultUnit = getDefaultUnit(result);

  return defaultUnit?.name ?? '1 g';
};

const getDefaultUnit = (result: UsdaIngredientResult): UsdaIngredientUnit | null => {
  const defaultUnit =
    result.units.find((unit) => createUsdaUnitKey(unit) === result.defaultUnitKey) ??
    result.units.find((unit) => unit.is_default) ??
    result.units[0] ??
    null;

  return defaultUnit;
};

const getSearchDisplayUnit = (
  result: UsdaIngredientResult,
): { label: string; multiplier: number } | null => {
  const defaultUnit = getDefaultUnit(result);
  if (defaultUnit && defaultUnit.grams > 1) {
    return {
      label: defaultUnit.name,
      multiplier: defaultUnit.grams,
    };
  }

  if (result.normalization.can_normalize && result.normalization.source_basis === 'per_100g') {
    return {
      label: '100 g',
      multiplier: 100,
    };
  }

  if (defaultUnit) {
    return {
      label: defaultUnit.name,
      multiplier: defaultUnit.grams,
    };
  }

  return null;
};

const normalizeNutritionValue = parseNutrient;

const normalizeMetadataNumber = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const mapUsdaResult = (item: Record<string, unknown>): UsdaIngredientResult | null => {
  const name = String(item.name ?? item.description ?? item.label ?? '').trim();
  if (!name) {
    return null;
  }

  const idValue = item.id ?? item.fdcId ?? item.foodId ?? item.food_id ?? name;
  const nutritionSource = (item.nutrition ?? item.nutrients ?? null) as Record<
    string,
    unknown
  > | null;
  const normalizationSource = (item.normalization ?? {}) as Record<string, unknown>;
  const canNormalize = Boolean(normalizationSource.can_normalize);
  const units = mapUsdaUnits(item.units);

  return {
    id: String(idValue),
    name,
    nutrition: nutritionSource
      ? {
          calories: normalizeNutritionValue(nutritionSource.calories ?? nutritionSource.energy),
          protein: normalizeNutritionValue(nutritionSource.protein),
          carbohydrates: normalizeNutritionValue(
            nutritionSource.carbohydrates ?? nutritionSource.carbs,
          ),
          fat: normalizeNutritionValue(nutritionSource.fat),
          fiber: normalizeNutritionValue(nutritionSource.fiber),
        }
      : null,
    normalization: {
      source_basis: String(normalizationSource.source_basis ?? 'unknown'),
      normalized_basis:
        normalizationSource.normalized_basis === null ||
        normalizationSource.normalized_basis === undefined
          ? null
          : String(normalizationSource.normalized_basis),
      can_normalize: canNormalize,
      reason:
        normalizationSource.reason === null || normalizationSource.reason === undefined
          ? null
          : String(normalizationSource.reason),
      data_type:
        normalizationSource.data_type === null || normalizationSource.data_type === undefined
          ? null
          : String(normalizationSource.data_type),
      serving_size: normalizeMetadataNumber(normalizationSource.serving_size),
      serving_size_unit:
        normalizationSource.serving_size_unit === null ||
        normalizationSource.serving_size_unit === undefined
          ? null
          : String(normalizationSource.serving_size_unit),
      household_serving_full_text:
        normalizationSource.household_serving_full_text === null ||
        normalizationSource.household_serving_full_text === undefined
          ? null
          : String(normalizationSource.household_serving_full_text),
    },
    units,
    defaultUnitKey: getDefaultUnitKey(units),
  };
};

const normalizeResults = (data: unknown): UsdaIngredientResult[] => {
  if (Array.isArray(data)) {
    return data
      .map((item) => {
        if (item && typeof item === 'object') {
          return mapUsdaResult(item as Record<string, unknown>);
        }
        return null;
      })
      .filter((result): result is UsdaIngredientResult => Boolean(result));
  }

  if (data && typeof data === 'object') {
    const possibleResults = (data as { results?: unknown; foods?: unknown }).results;
    const foodsResults = (data as { foods?: unknown }).foods;
    if (possibleResults) {
      return normalizeResults(possibleResults);
    }
    if (foodsResults) {
      return normalizeResults(foodsResults);
    }
  }

  return [];
};
const formatNutritionSummary = (result: UsdaIngredientResult): string => {
  if (!result.normalization.can_normalize || !result.nutrition) {
    const reason =
      result.normalization.reason ?? 'USDA basis is not safe to convert to per-gram nutrition.';
    return `${reason} Basis: ${result.normalization.source_basis}.`;
  }

  const searchDisplayUnit = getSearchDisplayUnit(result);
  const multiplier = searchDisplayUnit?.multiplier ?? 1;
  const label = searchDisplayUnit?.label ?? getDefaultUnitLabel(result);

  return `${label} · Calories ${formatNutritionValue(scaleNutrient(result.nutrition.calories, multiplier))} · Protein ${formatNutritionValue(scaleNutrient(result.nutrition.protein, multiplier))} · Carbs ${formatNutritionValue(scaleNutrient(result.nutrition.carbohydrates, multiplier))} · Fat ${formatNutritionValue(scaleNutrient(result.nutrition.fat, multiplier))}`;
};

function SourceEdit({ ingredient, dispatch, applyUsdaResult }) {
  const fetch = useAccountFetch();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UsdaIngredientResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedDataTypes, setSelectedDataTypes] = useState<USDADataType[]>(() =>
    ingredient.source === 'usda' ? DEFAULT_USDA_DATA_TYPES : [],
  );
  const [hasInitializedUsdaDataTypes, setHasInitializedUsdaDataTypes] = useState(
    ingredient.source === 'usda',
  );

  const selectedSource: IngredientSource = ingredient.source ?? 'manual';
  const disabledSearch = selectedSource !== 'usda';

  const hasResults = results.length > 0;

  useEffect(() => {
    if (selectedSource === 'usda' && !hasInitializedUsdaDataTypes) {
      setSelectedDataTypes(DEFAULT_USDA_DATA_TYPES);
      setHasInitializedUsdaDataTypes(true);
    }
  }, [hasInitializedUsdaDataTypes, selectedSource]);

  const statusMessage = useMemo(() => {
    if (isSearching) {
      return 'Searching USDA database...';
    }
    if (error) {
      return error;
    }
    if (!query.trim()) {
      return 'Enter a name to search the USDA database.';
    }
    if (!hasResults) {
      return 'No USDA matches yet. Try a different search.';
    }
    return null;
  }, [error, isSearching, query, hasResults]);

  const handleSourceChange = (event) => {
    const value = event.target.value as IngredientSource;
    dispatch({
      type: 'SET_INGREDIENT',
      payload: {
        ...ingredient,
        source: value,
        source_id: value === 'manual' ? null : (ingredient.source_id ?? null),
        sourceName: value === 'manual' ? null : (ingredient.sourceName ?? null),
      },
    });
  };

  const handleDataTypeChange = (_event: React.MouseEvent<HTMLElement>, value: USDADataType[]) => {
    if (value.length === 0) {
      return;
    }

    setSelectedDataTypes(value);
  };

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);
    setDetailError(null);

    try {
      const params = new URLSearchParams({ query: trimmed });
      const dataTypesForRequest =
        selectedDataTypes.length > 0 ? selectedDataTypes : DEFAULT_USDA_DATA_TYPES;
      dataTypesForRequest.forEach((dataType) => {
        params.append('data_types', dataType);
      });

      const response = await fetch(`/api/usda/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error('USDA search failed.');
      }
      const data = await response.json();
      setResults(normalizeResults(data));
    } catch (searchError) {
      setResults([]);
      setError('Unable to load USDA results right now.');
      console.error(searchError);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectResult = async (result: UsdaIngredientResult) => {
    if (!result.normalization.can_normalize || !result.nutrition) {
      setDetailError(
        result.normalization.reason ?? 'This USDA item cannot be imported as per-gram nutrition.',
      );
      return;
    }

    setIsLoadingDetail(true);
    setDetailError(null);

    try {
      const response = await fetch(`/api/usda/foods/${result.id}`);
      if (!response.ok) {
        throw new Error('USDA detail fetch failed.');
      }
      const data = await response.json();
      const mapped = mapUsdaResult(data);
      if (!mapped) {
        throw new Error('USDA detail mapping failed.');
      }

      const preferredMapped =
        mapped.units.length > 0
          ? mapped
          : {
              ...mapped,
              units: result.units,
              defaultUnitKey: result.defaultUnitKey,
            };

      if (!preferredMapped.normalization.can_normalize || !preferredMapped.nutrition) {
        throw new Error(
          preferredMapped.normalization.reason ?? 'USDA detail did not return per-gram nutrition.',
        );
      }
      applyUsdaResult(preferredMapped);
    } catch (detailFetchError) {
      setDetailError(
        detailFetchError instanceof Error
          ? detailFetchError.message
          : 'Unable to load USDA details. Using search results instead.',
      );
      applyUsdaResult(result);
      console.error(detailFetchError);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <FormControl sx={{ minWidth: 200 }}>
        <InputLabel id="ingredient-source-label">Source</InputLabel>
        <Select
          labelId="ingredient-source-label"
          label="Source"
          value={selectedSource}
          onChange={handleSourceChange}
        >
          <MenuItem value="manual">Manual</MenuItem>
          <MenuItem value="usda">USDA</MenuItem>
        </Select>
      </FormControl>

      {selectedSource === 'usda' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                label="Search USDA"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                fullWidth
              />
              <Button
                variant="outlined"
                onClick={handleSearch}
                disabled={disabledSearch || isSearching || isLoadingDetail}
              >
                Search
              </Button>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                Foundation is selected by default because it is the USDA’s primary current food-data
                set for this use case.
              </Typography>
              <ToggleButtonGroup
                value={selectedDataTypes}
                onChange={handleDataTypeChange}
                size="small"
                aria-label="USDA data types"
                sx={{ flexWrap: 'wrap', justifyContent: 'flex-start', gap: 0.75 }}
              >
                {USDA_DATA_TYPE_OPTIONS.map((option) => (
                  <ToggleButton
                    key={option.value}
                    value={option.value}
                    aria-label={option.label}
                    sx={{ textTransform: 'none', borderRadius: 1 }}
                  >
                    {option.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
          </Box>
          {(isSearching || isLoadingDetail) && <CircularProgress size={20} />}
          {statusMessage && (
            <Typography variant="body2" color={error ? 'error' : 'text.secondary'}>
              {statusMessage}
            </Typography>
          )}
          {detailError && (
            <Typography variant="body2" color="warning.main">
              {detailError}
            </Typography>
          )}
          {hasResults && (
            <List dense>
              {results.map((result) => {
                const isSupported = result.normalization.can_normalize && Boolean(result.nutrition);
                return (
                  <ListItem key={result.id} disablePadding>
                    <ListItemButton
                      onClick={() => handleSelectResult(result)}
                      disabled={!isSupported}
                    >
                      <ListItemText
                        primary={
                          <Box
                            sx={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              gap: 0.75,
                            }}
                          >
                            <Box component="span">{result.name}</Box>
                            {getUsdaDataTypeLabel(result.normalization.data_type, 'result') && (
                              <Chip
                                size="small"
                                label={getUsdaDataTypeLabel(result.normalization.data_type, 'result')}
                                variant="outlined"
                              />
                            )}
                          </Box>
                        }
                        secondary={formatNutritionSummary(result)}
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
      )}
    </Box>
  );
}

export default SourceEdit;
