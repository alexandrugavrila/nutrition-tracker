import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, type Mock } from "vitest";

import Shopping from "@/components/shopping/Shopping";
import { useData } from "@/contexts/DataContext";

vi.mock("@/contexts/DataContext");
vi.mock("@/components/common/IngredientModal", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("@/apiClient", () => ({
  __esModule: true,
  default: {
    path: vi.fn().mockReturnThis(),
    method: vi.fn().mockReturnThis(),
    create: vi.fn(),
  },
}));

import apiClient from "@/apiClient";
const mockedClient = vi.mocked(apiClient, true);

const mockUseSessionStorageState = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useSessionStorageState", () => ({
  __esModule: true,
  useSessionStorageState: mockUseSessionStorageState,
}));

describe("Shopping component", () => {
  const baseIngredient = {
    id: 1,
    name: "Oats",
    units: [
      { id: 10, ingredient_id: 1, name: "g", grams: 1 },
      { id: 11, ingredient_id: 1, name: "cup", grams: 90 },
    ],
    tags: [],
    nutrition: null,
    shoppingUnitId: 10,
  };
  let setIngredientsNeedsRefetch: Mock;
  let startRequest: Mock;
  let endRequest: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedClient.path.mockReturnThis();
    mockedClient.method.mockReturnThis();
    mockedClient.create.mockReturnValue(() => Promise.resolve({}));

    setIngredientsNeedsRefetch = vi.fn();
    startRequest = vi.fn();
    endRequest = vi.fn();

    mockUseSessionStorageState.mockImplementation((key: string, initial: unknown) => {
      if (key === "planning-plan") {
        return [[{ type: "ingredient", ingredientId: "1", unitId: 10, amount: 1, portions: 1 }], vi.fn()];
      }
      if (key === "planning-days") {
        return [1, vi.fn()];
      }
      if (key === "planning-active-plan") {
        return [{ id: null, label: null, updatedAt: null }, vi.fn()];
      }
      if (key === "shopping-excluded-items") {
        return [{}, vi.fn()];
      }
      const value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [value, vi.fn()];
    });

    (useData as unknown as Mock).mockReturnValue({
      ingredients: [baseIngredient],
      foods: [],
      fetching: false,
      hydrating: false,
      hydrated: true,
      setIngredients: vi.fn(),
      setIngredientsNeedsRefetch,
      startRequest,
      endRequest,
      ingredientProcessingTags: [],
      ingredientGroupTags: [],
      ingredientOtherTags: [],
      foodDietTags: [],
      foodTypeTags: [],
      foodOtherTags: [],
      fridgeInventory: [],
      setFridgeInventory: vi.fn(),
      setFridgeNeedsRefetch: vi.fn(),
    });
  });

  it("renders preferred units and updates selection", async () => {
    render(<Shopping />);

    const row = await screen.findByRole("row", { name: /Oats/i });
    const cells = within(row).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent(/^1 g$/);

    const unitSelect = within(row).getByRole("combobox");
    await userEvent.click(unitSelect);
    await userEvent.click(screen.getByRole("option", { name: /cup/i }));

    await waitFor(() => {
      expect(mockedClient.path).toHaveBeenCalledWith("/api/ingredients/1/shopping-preference");
      expect(mockedClient.method).toHaveBeenCalledWith("put");
      expect(mockedClient.create).toHaveBeenCalled();
      expect(startRequest).toHaveBeenCalled();
      expect(endRequest).toHaveBeenCalled();
      expect(setIngredientsNeedsRefetch).toHaveBeenCalledWith(true);
    });
  });

  it("omits excluded items from exports", async () => {
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWrite },
    });

    mockUseSessionStorageState.mockImplementation((key: string, initial: unknown) => {
      if (key === "planning-plan") {
        return [[{ type: "ingredient", ingredientId: "1", unitId: 10, amount: 1, portions: 1 }], vi.fn()];
      }
      if (key === "planning-days") {
        return [1, vi.fn()];
      }
      if (key === "planning-active-plan") {
        return [{ id: null, label: null, updatedAt: null }, vi.fn()];
      }
      if (key === "shopping-excluded-items") {
        return [{ "ingredient:1": true }, vi.fn()];
      }
      const value = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [value, vi.fn()];
    });

    render(<Shopping />);

    const checkbox = await screen.findByRole("checkbox", { name: /mark oats as needed/i });
    expect(checkbox).not.toBeChecked();

    await userEvent.click(await screen.findByRole("button", { name: /export/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: /copy as text/i }));

    await waitFor(() => {
      expect(clipboardWrite).not.toHaveBeenCalled();
      expect(screen.getByText(/nothing to copy/i)).toBeInTheDocument();
    });
  });
});
