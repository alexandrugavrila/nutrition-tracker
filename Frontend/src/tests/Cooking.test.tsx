import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, type Mock } from "vitest";

import Cooking from "@/components/cooking/Cooking";
import { useData } from "@/contexts/DataContext";

vi.mock("@/contexts/DataContext");

const mockUseSessionStorageState = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useSessionStorageState", () => ({
  __esModule: true,
  useSessionStorageState: mockUseSessionStorageState,
}));

describe("Cooking component", () => {
  let setActualState: Mock;
  let planData: unknown;
  let actualState: unknown;
  let mockFetch: Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();

    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: (name: string) => (name === "content-type" ? "application/json" : null) },
      json: vi.fn().mockResolvedValue({}),
      text: vi.fn().mockResolvedValue(""),
    };
    mockFetch = vi.fn().mockResolvedValue(response);
    global.fetch = mockFetch as unknown as typeof fetch;

    planData = [];
    actualState = { portions: {}, ingredientTotals: {} };
    setActualState = vi.fn();

    mockUseSessionStorageState.mockImplementation((key: string, initial: unknown) => {
      if (key === "planning-plan") {
        return [planData, vi.fn()];
      }
      if (key === "planning-days") {
        return [1, vi.fn()];
      }
      if (key === "planning-active-plan") {
        return [{ id: null, label: null, updatedAt: null }, vi.fn()];
      }
      if (key === "cooking-actuals") {
        return [actualState, setActualState];
      }
      if (key === "cooking-completed-plan-keys") {
        return React.useState(
          initial as string[] | (() => string[]),
        );
      }
      const value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [value, vi.fn()];
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([5, 0, null])("posts cooking results preserving fiber %s", async (fiber: number | null) => {
    const foodPlan = [
      {
        type: "food",
        foodId: "1",
        portions: 2,
        overrides: {},
      },
    ];
    const foodActualState = {
      portions: { "food:0:1": 2 },
      ingredientTotals: { "foodIngredient:0:101": { quantity: 120, unitId: 100 } },
    };
    planData = foodPlan;
    actualState = foodActualState;

    const setFridgeNeedsRefetch = vi.fn();
    (useData as unknown as Mock).mockReturnValue({
      foods: [
        {
          id: 1,
          name: "Veggie Chili",
          ingredients: [
            {
              ingredient_id: 101,
              unit_id: 100,
              unit_quantity: 1,
            },
          ],
        },
      ],
      ingredients: [
        {
          id: 101,
          name: "Beans",
          units: [
            { id: 100, ingredient_id: 101, name: "g", grams: 1 },
          ],
          tags: [],
          nutrition: {
            calories: 1,
            protein: 2,
            fat: 3,
            carbohydrates: 4,
            fiber,
          },
        },
      ],
      fetching: false,
      hydrating: false,
      hydrated: true,
      setIngredients: vi.fn(),
      setIngredientsNeedsRefetch: vi.fn(),
      startRequest: vi.fn(),
      endRequest: vi.fn(),
      ingredientProcessingTags: [],
      ingredientGroupTags: [],
      ingredientOtherTags: [],
      foodsNeedsRefetch: false,
      setFoodsNeedsRefetch: vi.fn(),
      foodDietTags: [],
      foodTypeTags: [],
      foodOtherTags: [],
      fridgeInventory: [],
      setFridgeInventory: vi.fn(),
      setFridgeNeedsRefetch,
    });

    render(<Cooking />);

    const completeButton = await screen.findByRole("button", { name: /mark complete/i });
    await userEvent.click(completeButton);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/stored_food/",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const [, requestInit] = mockFetch.mock.calls[0];
    const parsedBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(parsedBody).toEqual({
      label: "Veggie Chili",
      food_id: 1,
      ingredient_id: null,
      prepared_portions: 2,
      remaining_portions: 2,
      per_portion_calories: 60,
      per_portion_protein: 120,
      per_portion_carbohydrates: 240,
      per_portion_fat: 180,
      per_portion_fiber: fiber === null ? null : fiber * 60,
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /mark complete/i }),
      ).not.toBeInTheDocument();
    });

    expect(setActualState).toHaveBeenCalled();
    expect(setFridgeNeedsRefetch).toHaveBeenCalledWith(true);
  });

  it("marks an ingredient complete with the planned portion count", async () => {
    const ingredientPlan = [
      {
        type: "ingredient",
        ingredientId: "201",
        unitId: 200,
        amount: 1,
        portions: 5,
      },
    ];
    const ingredientActualState = {
      portions: {},
      ingredientTotals: { "ingredient:0:201": { quantity: 5, unitId: 200 } },
    };
    planData = ingredientPlan;
    actualState = ingredientActualState;

    const setFridgeNeedsRefetch = vi.fn();
    (useData as unknown as Mock).mockReturnValue({
      foods: [],
      ingredients: [
        {
          id: 201,
          name: "Protein Shake",
          units: [
            { id: 200, ingredient_id: 201, name: "bottle", grams: 1 },
          ],
          tags: [],
          nutrition: {
            calories: 10,
            protein: 2,
            fat: 3,
            carbohydrates: 4,
            fiber: 5,
          },
        },
      ],
      fetching: false,
      hydrating: false,
      hydrated: true,
      setIngredients: vi.fn(),
      setIngredientsNeedsRefetch: vi.fn(),
      startRequest: vi.fn(),
      endRequest: vi.fn(),
      ingredientProcessingTags: [],
      ingredientGroupTags: [],
      ingredientOtherTags: [],
      foodsNeedsRefetch: false,
      setFoodsNeedsRefetch: vi.fn(),
      foodDietTags: [],
      foodTypeTags: [],
      foodOtherTags: [],
      fridgeInventory: [],
      setFridgeInventory: vi.fn(),
      setFridgeNeedsRefetch,
    });

    render(<Cooking />);

    const completeButton = await screen.findByRole("button", { name: /mark complete/i });
    await userEvent.click(completeButton);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [, requestInit] = mockFetch.mock.calls[0];
    const parsedBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(parsedBody).toEqual({
      label: "Protein Shake (5 bottle)",
      food_id: null,
      ingredient_id: 201,
      prepared_portions: 5,
      remaining_portions: 5,
      per_portion_calories: 10,
      per_portion_protein: 2,
      per_portion_carbohydrates: 4,
      per_portion_fat: 3,
      per_portion_fiber: 5,
    });

    await waitFor(() => {
      expect(setFridgeNeedsRefetch).toHaveBeenCalledWith(true);
    });
  });

  it("shows an error alert when marking an ingredient fails", async () => {
    const ingredientPlan = [
      {
        type: "ingredient",
        ingredientId: "201",
        unitId: 200,
        amount: 150,
        portions: 1,
      },
    ];
    const ingredientActualState = {
      portions: {},
      ingredientTotals: { "ingredient:0:201": { quantity: 150, unitId: 200 } },
    };
    planData = ingredientPlan;
    actualState = ingredientActualState;

    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    (useData as unknown as Mock).mockReturnValue({
      foods: [],
      ingredients: [
        {
          id: 201,
          name: "Roasted Carrots",
          units: [{ id: 200, ingredient_id: 201, name: "g", grams: 1 }],
          tags: [],
          nutrition: {
            calories: 1,
            protein: 1,
            fat: 1,
            carbohydrates: 1,
            fiber: 1,
          },
        },
      ],
      fetching: false,
      hydrating: false,
      hydrated: true,
      setIngredients: vi.fn(),
      setIngredientsNeedsRefetch: vi.fn(),
      startRequest: vi.fn(),
      endRequest: vi.fn(),
      ingredientProcessingTags: [],
      ingredientGroupTags: [],
      ingredientOtherTags: [],
      foodsNeedsRefetch: false,
      setFoodsNeedsRefetch: vi.fn(),
      foodDietTags: [],
      foodTypeTags: [],
      foodOtherTags: [],
      fridgeInventory: [],
      setFridgeInventory: vi.fn(),
      setFridgeNeedsRefetch: vi.fn(),
    });

    render(<Cooking />);

    const completeButton = await screen.findByRole("button", { name: /mark complete/i });
    await userEvent.click(completeButton);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const errorMessage = await screen.findByText(
      /Failed to mark item complete\. Network error/i,
    );
    expect(errorMessage.closest('[role="alert"]')).toBeInTheDocument();

    expect(screen.getByText(/Roasted Carrots/)).toBeInTheDocument();
    expect(completeButton).not.toBeDisabled();
  });
});
