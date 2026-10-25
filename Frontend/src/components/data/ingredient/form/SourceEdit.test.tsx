import React from 'react';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useData } from '@/contexts/DataContext';

import SourceEdit from './SourceEdit';
import { useIngredientForm } from './useIngredientForm';

vi.mock('@/contexts/DataContext', () => ({
  useData: vi.fn(),
}));

const mockedUseData = vi.mocked(useData);

const baseIngredient = {
  id: 1,
  name: 'Test Ingredient',
  units: [
    {
      id: 'unit-1',
      ingredient_id: 1,
      name: 'g',
      grams: '1',
    },
  ],
  shoppingUnitId: 'unit-1',
  nutrition: {
    calories: 0,
    protein: 0,
    carbohydrates: 0,
    fat: 0,
    fiber: 0,
  },
  tags: [],
  source: 'usda',
  source_id: null,
  sourceName: null,
};

beforeEach(() => {
  mockedUseData.mockReturnValue({
    setIngredientsNeedsRefetch: vi.fn(),
    startRequest: vi.fn(),
    endRequest: vi.fn(),
  } as never);
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('SourceEdit', () => {
  it(
    'shows USDA dataset toggles, defaults to Foundation, and updates request params when toggles change',
    async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ foods: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SourceEdit
        ingredient={baseIngredient as never}
        dispatch={vi.fn()}
        applyUsdaResult={vi.fn()}
      />,
    );

    const dataTypeToggleGroup = screen.getByLabelText(/usda data types/i);
    expect(dataTypeToggleGroup).toBeInTheDocument();

    const foundationToggle = screen.getByRole('button', {
      name: /foundation \(primary \/ most current usda data\)/i,
    });
    const brandedToggle = screen.getByRole('button', { name: /^branded$/i });
    const experimentalToggle = screen.getByRole('button', { name: /^experimental$/i });
    const srLegacyToggle = screen.getByRole('button', { name: /^sr legacy$/i });

    expect(foundationToggle).toHaveAttribute('aria-pressed', 'true');
    expect(brandedToggle).toHaveAttribute('aria-pressed', 'false');
    expect(experimentalToggle).toHaveAttribute('aria-pressed', 'false');
    expect(srLegacyToggle).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByText(
        /foundation is selected by default because it is the usda’s primary current food-data set for this use case/i,
      ),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/search usda/i), 'banana');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/usda/search?query=banana&data_types=Foundation',
    );

    await userEvent.click(brandedToggle);
    await userEvent.click(experimentalToggle);
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/usda/search?query=banana&data_types=Foundation&data_types=Branded&data_types=Experimental',
    );

    await userEvent.click(foundationToggle);
    await userEvent.click(experimentalToggle);
    await userEvent.click(srLegacyToggle);
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/usda/search?query=banana&data_types=Branded&data_types=SR+Legacy',
    );
    expect(screen.getByLabelText(/search usda/i)).toHaveValue('banana');
    },
    10000,
  );

  it('shows the USDA default unit in search results and prefers detail units on selection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          foods: [
            {
              id: 123,
              name: 'Banana',
              nutrition: {
                calories: 0.89,
                protein: 0.0109,
                carbohydrates: 0.2284,
                fat: 0.0033,
                fiber: 0.026,
              },
              normalization: {
                can_normalize: true,
                source_basis: 'per_100g',
                normalized_basis: 'per_g',
                reason: null,
                data_type: 'Foundation',
                serving_size: null,
                serving_size_unit: null,
                household_serving_full_text: null,
              },
              units: [
                { name: '1 g', grams: 1, is_default: false },
                { name: '1 medium', grams: 118, is_default: true },
              ],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 123,
          name: 'Banana',
          nutrition: {
            calories: 0.89,
            protein: 0.0109,
            carbohydrates: 0.2284,
            fat: 0.0033,
            fiber: 0.026,
          },
          normalization: {
            can_normalize: true,
            source_basis: 'per_100g',
            normalized_basis: 'per_g',
            reason: null,
            data_type: 'Foundation',
            serving_size: null,
            serving_size_unit: null,
            household_serving_full_text: null,
          },
          units: [
            { name: '1 g', grams: 1, is_default: false },
            { name: '1 large', grams: 136, is_default: true },
            { name: '1 cup sliced', grams: 150, is_default: false },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const applyUsdaResult = vi.fn();
    render(
      <SourceEdit
        ingredient={baseIngredient as never}
        dispatch={vi.fn()}
        applyUsdaResult={applyUsdaResult}
      />,
    );

    await userEvent.type(screen.getByLabelText(/search usda/i), 'banana');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));

    const bananaRow = await screen.findByRole('button', { name: /banana/i });
    expect(bananaRow).toBeEnabled();
    expect(await screen.findByText(/Foundation \(primary\)/i)).toBeInTheDocument();
    expect(
      await screen.findByText(
        /1 medium · Calories 105\.02 · Protein 1\.29 · Carbs 26\.95 · Fat 0\.39/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Per gram/i)).not.toBeInTheDocument();

    await userEvent.click(bananaRow);

    await waitFor(() => {
      expect(applyUsdaResult).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '123',
          name: 'Banana',
          units: [
            expect.objectContaining({ name: '1 g', grams: 1, is_default: false }),
            expect.objectContaining({ name: '1 large', grams: 136, is_default: true }),
            expect.objectContaining({ name: '1 cup sliced', grams: 150, is_default: false }),
          ],
          defaultUnitKey: 'name:1 large|grams:136',
          nutrition: expect.objectContaining({
            calories: 0.89,
            protein: 0.0109,
          }),
          normalization: expect.objectContaining({
            can_normalize: true,
            source_basis: 'per_100g',
          }),
        }),
      );
    });
  });

  it('falls back to 100 g in USDA search results when the only available default is 1 g', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [
          {
            id: 789,
            name: 'Apple',
            nutrition: {
              calories: 0.52,
              protein: 0.0003,
              carbohydrates: 0.14,
              fat: 0.0002,
              fiber: 0.024,
            },
            normalization: {
              can_normalize: true,
              source_basis: 'per_100g',
              normalized_basis: 'per_g',
              reason: null,
              data_type: 'Foundation',
              serving_size: null,
              serving_size_unit: null,
              household_serving_full_text: null,
            },
            units: [{ name: '1 g', grams: 1, is_default: true }],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SourceEdit
        ingredient={baseIngredient as never}
        dispatch={vi.fn()}
        applyUsdaResult={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText(/search usda/i), 'apple');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));

    expect(
      await screen.findByText(/100 g · Calories 52 · Protein 0\.03 · Carbs 14 · Fat 0\.02/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/1 g · Calories 0\.52/i)).not.toBeInTheDocument();
  });


  it('renders dataset labels from normalization.data_type for mixed USDA result rows', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [
          {
            id: 11,
            name: 'Foundation fennel bulb',
            nutrition: {
              calories: 0.31,
              protein: 0.012,
              carbohydrates: 0.073,
              fat: 0.002,
              fiber: 0.031,
            },
            normalization: {
              can_normalize: true,
              source_basis: 'per_100g',
              normalized_basis: 'per_g',
              reason: null,
              data_type: 'Foundation',
              serving_size: null,
              serving_size_unit: null,
              household_serving_full_text: null,
            },
            units: [{ name: '1 fennel bulb', grams: 234, is_default: true }],
          },
          {
            id: 22,
            name: 'Legacy lentil mix',
            nutrition: {
              calories: 3.52,
              protein: 0.241,
              carbohydrates: 0.602,
              fat: 0.011,
              fiber: 0.107,
            },
            normalization: {
              can_normalize: true,
              source_basis: 'per_100g',
              normalized_basis: 'per_g',
              reason: null,
              data_type: 'SR Legacy',
              serving_size: null,
              serving_size_unit: null,
              household_serving_full_text: null,
            },
            units: [{ name: '1 scoop', grams: 42, is_default: true }],
          },
          {
            id: 33,
            name: 'Survey snack clusters',
            nutrition: {
              calories: 4.01,
              protein: 0.081,
              carbohydrates: 0.713,
              fat: 0.091,
              fiber: 0.044,
            },
            normalization: {
              can_normalize: true,
              source_basis: 'per_100g',
              normalized_basis: 'per_g',
              reason: null,
              data_type: 'Survey (FNDDS)',
              serving_size: null,
              serving_size_unit: null,
              household_serving_full_text: null,
            },
            units: [{ name: '1 pouch', grams: 28, is_default: true }],
          },
          {
            id: 44,
            name: 'Branded berry bites',
            nutrition: null,
            normalization: {
              can_normalize: false,
              source_basis: 'per_serving',
              normalized_basis: null,
              reason: 'Serving-only data cannot be normalized safely.',
              data_type: 'Branded',
              serving_size: 50,
              serving_size_unit: 'g',
              household_serving_full_text: '1 pack',
            },
            units: [{ name: '1 pack', grams: 50, is_default: true }],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <SourceEdit
        ingredient={baseIngredient as never}
        dispatch={vi.fn()}
        applyUsdaResult={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText(/search usda/i), 'mix');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));

    const resultsList = await screen.findByRole('list');
    const foundationRow = within(resultsList)
      .getByRole('button', { name: /foundation fennel bulb/i })
      .closest('li');
    const legacyRow = within(resultsList)
      .getByRole('button', { name: /legacy lentil mix/i })
      .closest('li');
    const surveyRow = within(resultsList)
      .getByRole('button', { name: /survey snack clusters/i })
      .closest('li');
    const brandedRow = within(resultsList)
      .getByRole('button', { name: /branded berry bites/i })
      .closest('li');

    expect(
      within(foundationRow as HTMLElement).getByText('Foundation (primary)'),
    ).toBeInTheDocument();
    expect(within(legacyRow as HTMLElement).getByText('SR Legacy')).toBeInTheDocument();
    expect(within(surveyRow as HTMLElement).getByText('Survey (FNDDS)')).toBeInTheDocument();
    expect(within(brandedRow as HTMLElement).getByText('Branded')).toBeInTheDocument();
    expect(
      within(brandedRow as HTMLElement).getByText(/serving-only data cannot be normalized safely/i),
    ).toBeInTheDocument();
  });

  it('disables USDA results that cannot be normalized to per-gram nutrition', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        foods: [
          {
            id: 456,
            name: 'Orange juice',
            nutrition: null,
            normalization: {
              can_normalize: false,
              source_basis: 'per_100ml',
              normalized_basis: null,
              reason:
                'USDA branded nutrients are standardized to 100 mL for this item, so they cannot be converted to per-gram values without density data.',
              data_type: 'Branded',
              serving_size: 240,
              serving_size_unit: 'ml',
              household_serving_full_text: '8 fl oz',
            },
            units: [{ name: '1 g', grams: 1, is_default: true }],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const applyUsdaResult = vi.fn();
    render(
      <SourceEdit
        ingredient={baseIngredient as never}
        dispatch={vi.fn()}
        applyUsdaResult={applyUsdaResult}
      />,
    );

    await userEvent.type(screen.getByLabelText(/search usda/i), 'juice');
    await userEvent.click(screen.getByRole('button', { name: /search/i }));

    const resultButton = await screen.findByRole('button', { name: /orange juice/i });
    expect(resultButton).toHaveAttribute('aria-disabled', 'true');
    expect(
      await screen.findByText(/cannot be converted to per-gram values without density data/i),
    ).toBeInTheDocument();
    expect(applyUsdaResult).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retains the USDA default unit in form state and imports rounded per-gram USDA nutrition', () => {
    const { result } = renderHook(() => useIngredientForm());

    act(() => {
      result.current.applyUsdaResult({
        id: '333',
        name: 'Apple slices',
        nutrition: {
          calories: 0.52,
          protein: 0.0003,
          carbohydrates: 0.14,
          fat: 0.0002,
          fiber: 0.024,
        },
        normalization: {
          source_basis: 'per_100g',
          normalized_basis: 'per_g',
          can_normalize: true,
          reason: null,
          data_type: 'Foundation',
          serving_size: null,
          serving_size_unit: null,
          household_serving_full_text: null,
        },
        units: [
          { name: '1 g', grams: 1, is_default: false },
          { name: '1 cup sliced', grams: 109, is_default: true },
          { name: '1 tbsp', grams: 8.5, is_default: false },
        ],
        defaultUnitKey: 'name:1 cup sliced|grams:109',
      });
    });

    expect(result.current.ingredient.source).toBe('usda');
    expect(result.current.ingredient.source_id).toBe('333');
    expect(result.current.ingredient.sourceName).toBe('Apple slices');
    expect(result.current.ingredient.nutrition).toEqual({
      calories: 0.52,
      protein: 0,
      carbohydrates: 0.14,
      fat: 0,
      fiber: 0.02,
    });
    expect(result.current.ingredient.units).toEqual([
      expect.objectContaining({ name: 'g', grams: 1 }),
      expect.objectContaining({ name: '1 cup sliced', grams: 109 }),
      expect.objectContaining({ name: '1 tbsp', grams: 8.5 }),
    ]);

    const selectedUnit = result.current.ingredient.units.find(
      (unit) => String(unit.id) === String(result.current.ingredient.shoppingUnitId),
    );
    expect(selectedUnit).toEqual(expect.objectContaining({ name: '1 cup sliced', grams: 109 }));
  });
});
