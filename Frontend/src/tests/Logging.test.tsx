import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, type Mock } from "vitest";

import Logging from "@/components/logging/Logging";
import { useData } from "@/contexts/DataContext";

vi.mock("@/contexts/DataContext");

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

type RequestHandler = Mock<
  [options?: { body?: unknown }],
  Promise<{ data: unknown }>
>;

describe("Logging component", () => {
  const fridgeItem = {
    id: 1,
    label: "Veg Chili",
    user_id: "tester",
    food_id: 10,
    ingredient_id: null,
    prepared_portions: 4,
    remaining_portions: 3,
    per_portion_calories: 100,
    per_portion_protein: 10,
    per_portion_carbohydrates: 15,
    per_portion_fat: 5,
    per_portion_fiber: 6,
    is_finished: false,
    prepared_at: "2024-01-15T12:00:00Z",
    updated_at: "2024-01-15T12:00:00Z",
    completed_at: null,
  };

  const ingredient = {
    id: 5,
    name: "Beans",
    units: [{ id: 7, name: "cup", grams: 100 }],
    tags: [],
    nutrition: {
      calories: 1,
      protein: 2,
      fat: 3,
      carbohydrates: 4,
      fiber: 5,
    },
    shoppingUnitId: null,
  };

  const food = {
    id: 10,
    name: "Veg Chili",
    ingredients: [],
    tags: [],
  };

  let setFridgeNeedsRefetch: Mock;
  let startRequest: Mock;
  let endRequest: Mock;
  let today: string;
  let requestHandlers: Map<string, RequestHandler>;
  let lastPath: string;
  let lastMethod: string;
  let consumeHandler: RequestHandler;
  let logHandler: RequestHandler;

  const createDataContextValue = (
    overrides: Record<string, unknown> = {},
  ) => ({
    fridgeInventory: [fridgeItem],
    foods: [food],
    ingredients: [ingredient],
    setFridgeInventory: vi.fn(),
    setIngredients: vi.fn(),
    setFridgeNeedsRefetch,
    setIngredientsNeedsRefetch: vi.fn(),
    setFoodsNeedsRefetch: vi.fn(),
    startRequest,
    endRequest,
    hydrating: false,
    fetching: false,
    hydrated: true,
    ingredientProcessingTags: [],
    ingredientGroupTags: [],
    ingredientOtherTags: [],
    foodDietTags: [],
    foodTypeTags: [],
    foodOtherTags: [],
    addPossibleIngredientTag: vi.fn(async () => null),
    addPossibleFoodTag: vi.fn(async () => null),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requestHandlers = new Map();
    lastPath = "";
    lastMethod = "";

    mockedClient.path.mockImplementation((path: string) => {
      lastPath = path;
      return mockedClient;
    });
    mockedClient.method.mockImplementation((method: string) => {
      lastMethod = method;
      return mockedClient;
    });
    mockedClient.create.mockImplementation(() => {
      const key = `${(lastMethod || "").toUpperCase()} ${lastPath}`;
      const handler = requestHandlers.get(key);
      if (!handler) {
        return vi.fn(async () => ({ data: [] }));
      }
      return handler;
    });

    today = new Date().toISOString().slice(0, 10);
    consumeHandler = vi.fn(async (options = {}) => {
      expect(options?.body).toEqual({ portions: 1.5 });
      return { data: {} };
    });
    requestHandlers.set(
      `POST /api/stored_food/${fridgeItem.id}/consume`,
      consumeHandler,
    );
    requestHandlers.set(
      `GET /api/logs/${today}`,
      vi.fn(async () => ({ data: [] })),
    );

    setFridgeNeedsRefetch = vi.fn();
    startRequest = vi.fn();
    endRequest = vi.fn();

    (useData as unknown as Mock).mockReturnValue(createDataContextValue());
  });

  it("renders fridge items grouped and shows the log date picker", () => {
    render(<Logging />);

    expect(screen.getByText(/Fridge Inventory/i)).toBeInTheDocument();
    expect(screen.getByText(/Quick Log/i)).toBeInTheDocument();
    expect(screen.getByText(/Fridge Items/i)).toBeInTheDocument();
    expect(screen.queryByText(/Prepared Foods/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Log date/i)).toBeInTheDocument();
    expect(screen.getByText(/Daily Log/i)).toBeInTheDocument();
  });

  it.each([6, 0, null])("logs consumption and preserves fiber %s in daily totals", async (fiber: number | null) => {
    (useData as unknown as Mock).mockReturnValue(createDataContextValue({ fridgeInventory: [{ ...fridgeItem, per_portion_fiber: fiber }] }));
    const logResponse = {
      id: 42,
      user_id: fridgeItem.user_id,
      log_date: today,
      stored_food_id: fridgeItem.id,
      ingredient_id: null,
      food_id: fridgeItem.food_id,
      portions_consumed: 1.5,
      calories: 150,
      protein: 15,
      carbohydrates: 22.5,
      fat: 7.5,
      fiber: fiber === null ? null : fiber * 1.5,
      created_at: `${today}T12:00:00Z`,
    };

    logHandler = vi.fn(async (options = {}) => {
      expect(options?.body).toMatchObject({
        log_date: today,
        stored_food_id: fridgeItem.id,
        portions_consumed: 1.5,
        calories: 150,
        protein: 15,
        carbohydrates: 22.5,
        fat: 7.5,
        fiber: fiber === null ? null : fiber * 1.5,
      });
      return { data: logResponse };
    });
    requestHandlers.set("POST /api/logs/", logHandler);

    render(<Logging />);

    await waitFor(() => {
      expect(mockedClient.path).toHaveBeenCalledWith(`/api/logs/${today}`);
    });

    const portionsInput = screen.getByLabelText(
      /Portions to log for Veg Chili/i,
    ) as HTMLInputElement;

    await userEvent.type(portionsInput, "{selectall}1.5");

    const logButton = screen.getByRole("button", { name: /Add to log/i });
    await userEvent.click(logButton);

    await waitFor(() => {
      expect(consumeHandler).toHaveBeenCalled();
      expect(logHandler).toHaveBeenCalled();
      expect(setFridgeNeedsRefetch).toHaveBeenCalledWith(true);
      expect(startRequest).toHaveBeenCalled();
      expect(endRequest).toHaveBeenCalled();
    });

    const totalSummary = await screen.findByRole("group", {
      name: /Daily Total/i,
    });
    expect(
      within(totalSummary).getByLabelText(/Total portions/i),
    ).toHaveTextContent("1.5");
    expect(
      within(totalSummary).getByLabelText(/Total calories/i),
    ).toHaveTextContent("150");
    expect(
      within(totalSummary).getByLabelText(/Total protein/i),
    ).toHaveTextContent("15");
    expect(
      within(totalSummary).getByLabelText(/Total carbs/i),
    ).toHaveTextContent("22.5");
    expect(
      within(totalSummary).getByLabelText(/Total fat/i),
    ).toHaveTextContent("7.5");
    expect(
      within(totalSummary).getByLabelText(/Total fiber/i),
    ).toHaveTextContent(fiber === null ? "Unavailable" : String(fiber * 1.5));
  });

  it("logs a standalone ingredient entry", async () => {
    const standaloneIngredient = {
      id: 20,
      name: "Spinach",
      units: [{ id: 1, name: "gram", grams: 1 }],
      nutrition: {
        calories: 1,
        protein: 2,
        fat: 3,
        carbohydrates: 4,
        fiber: 5,
      },
      tags: [],
      shoppingUnitId: null,
    };

    const logResponse = {
      id: 99,
      user_id: "demo-user",
      log_date: today,
      stored_food_id: null,
      ingredient_id: standaloneIngredient.id,
      food_id: null,
      portions_consumed: 2,
      calories: 2,
      protein: 4,
      carbohydrates: 8,
      fat: 6,
      fiber: 10,
      created_at: `${today}T09:00:00Z`,
    };

    logHandler = vi.fn(async (options = {}) => {
      expect(options?.body).toMatchObject({
        log_date: today,
        ingredient_id: standaloneIngredient.id,
        stored_food_id: null,
        food_id: null,
        portions_consumed: 2,
        calories: 2,
        protein: 4,
        carbohydrates: 8,
        fat: 6,
        fiber: 10,
      });
      return { data: logResponse };
    });
    requestHandlers.set("POST /api/logs/", logHandler);

    (useData as unknown as Mock).mockReturnValue(
      createDataContextValue({
        fridgeInventory: [],
        foods: [],
        ingredients: [standaloneIngredient],
      }),
    );

    render(<Logging />);

    await waitFor(() => {
      expect(mockedClient.path).toHaveBeenCalledWith(`/api/logs/${today}`);
    });

    await userEvent.click(
      screen.getByRole("button", { name: /Add Ingredient/i }),
    );
    const ingredientDialog = await screen.findByRole("dialog");
    const ingredientRow = within(ingredientDialog)
      .getByText(/Spinach/i)
      .closest("tr");
    if (!ingredientRow) {
      throw new Error("Ingredient row not found");
    }
    await userEvent.click(
      within(ingredientRow).getByRole("button", { name: /Select/i }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const quantityInput = screen.getByLabelText("Quantity") as HTMLInputElement;
    await userEvent.clear(quantityInput);
    await userEvent.type(quantityInput, "2");

    await userEvent.click(screen.getByRole("button", { name: /Log ingredient/i }));

    await waitFor(() => {
      expect(logHandler).toHaveBeenCalled();
      expect(startRequest).toHaveBeenCalled();
      expect(endRequest).toHaveBeenCalled();
    });

    expect(setFridgeNeedsRefetch).not.toHaveBeenCalled();
    const dailyLogTable = await screen.findByRole("table");
    expect(within(dailyLogTable).getByText("Spinach")).toBeInTheDocument();
  });

  it("logs a standalone food entry", async () => {
    const standaloneIngredient = {
      id: 30,
      name: "Tofu",
      units: [{ id: 11, name: "gram", grams: 1 }],
      nutrition: {
        calories: 2,
        protein: 4,
        fat: 6,
        carbohydrates: 8,
        fiber: 10,
      },
      tags: [],
      shoppingUnitId: null,
    };

    const standaloneFood = {
      id: 31,
      name: "Protein Bowl",
      ingredients: [
        {
          ingredient_id: standaloneIngredient.id,
          unit_id: 11,
          unit_quantity: 3,
        },
      ],
      tags: [],
    };

    const logResponse = {
      id: 100,
      user_id: "demo-user",
      log_date: today,
      stored_food_id: null,
      ingredient_id: null,
      food_id: standaloneFood.id,
      portions_consumed: 0.5,
      calories: 3,
      protein: 6,
      carbohydrates: 12,
      fat: 9,
      fiber: 15,
      created_at: `${today}T10:00:00Z`,
    };

    logHandler = vi.fn(async (options = {}) => {
      const payload = options?.body as Record<string, unknown>;
      expect(payload).toMatchObject({
        log_date: today,
        food_id: standaloneFood.id,
        stored_food_id: null,
        ingredient_id: null,
      });
      expect(Number(payload?.portions_consumed)).toBeCloseTo(0.5);
      expect(Number(payload?.calories)).toBeCloseTo(3);
      expect(Number(payload?.protein)).toBeCloseTo(6);
      expect(Number(payload?.carbohydrates)).toBeCloseTo(12);
      expect(Number(payload?.fat)).toBeCloseTo(9);
      expect(Number(payload?.fiber)).toBeCloseTo(15);
      return { data: logResponse };
    });
    requestHandlers.set("POST /api/logs/", logHandler);

    (useData as unknown as Mock).mockReturnValue(
      createDataContextValue({
        fridgeInventory: [],
        foods: [standaloneFood],
        ingredients: [standaloneIngredient],
      }),
    );

    render(<Logging />);

    await waitFor(() => {
      expect(mockedClient.path).toHaveBeenCalledWith(`/api/logs/${today}`);
    });

    await userEvent.click(screen.getByRole("button", { name: /Add Food/i }));
    const foodDialog = await screen.findByRole("dialog");
    const foodRow = within(foodDialog).getByText(/Protein Bowl/i).closest("tr");
    if (!foodRow) {
      throw new Error("Food row not found");
    }
    await userEvent.click(
      within(foodRow).getByRole("button", { name: /Select/i }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    const servingsInput = screen.getByLabelText("Servings") as HTMLInputElement;
    await userEvent.clear(servingsInput);
    await userEvent.type(servingsInput, "0.5");

    await userEvent.click(screen.getByRole("button", { name: /Log food/i }));

    await waitFor(() => {
      expect(logHandler).toHaveBeenCalled();
      expect(startRequest).toHaveBeenCalled();
      expect(endRequest).toHaveBeenCalled();
    });

    expect(setFridgeNeedsRefetch).not.toHaveBeenCalled();
    const dailyLogTable = await screen.findByRole("table");
    expect(within(dailyLogTable).getByText("Protein Bowl")).toBeInTheDocument();
  });

  it("removes fridge items when requested", async () => {
    const deleteHandler = vi.fn(async () => ({ data: {} }));
    requestHandlers.set(
      `DELETE /api/stored_food/${fridgeItem.id}`,
      deleteHandler,
    );

    render(<Logging />);

    await waitFor(() => {
      expect(mockedClient.path).toHaveBeenCalledWith(`/api/logs/${today}`);
    });

    const fridgeLabel = screen.getAllByText(fridgeItem.label)[0];
    const fridgeRow = fridgeLabel.closest("tr");
    if (!fridgeRow) {
      throw new Error("Fridge row not found");
    }
    const removeButton = within(fridgeRow).getByRole("button", {
      name: "Remove",
    });

    await userEvent.click(removeButton);

    await waitFor(() => {
      expect(deleteHandler).toHaveBeenCalled();
      expect(setFridgeNeedsRefetch).toHaveBeenCalledWith(true);
      expect(startRequest).toHaveBeenCalled();
      expect(endRequest).toHaveBeenCalled();
    });

    expect(
      await screen.findByText(/Removed Veg Chili from the fridge/i),
    ).toBeInTheDocument();
  });

  it("removes logged entries and updates the table", async () => {
    const logResponse = {
      id: 101,
      user_id: fridgeItem.user_id,
      log_date: today,
      stored_food_id: fridgeItem.id,
      ingredient_id: null,
      food_id: fridgeItem.food_id,
      portions_consumed: 1,
      calories: 100,
      protein: 10,
      carbohydrates: 15,
      fat: 5,
      fiber: 6,
      created_at: `${today}T07:00:00Z`,
    };

    const listLogsHandler = vi.fn(async () => ({ data: [logResponse] }));
    requestHandlers.set(`GET /api/logs/${today}`, listLogsHandler);

    const deleteLogHandler = vi.fn(async () => ({ data: {} }));
    requestHandlers.set(
      `DELETE /api/logs/${logResponse.id}`,
      deleteLogHandler,
    );

    render(<Logging />);

    const logsHeading = screen.getByText(/Daily Log/i);
    const logsCard = logsHeading.closest(".MuiCard-root") ?? logsHeading.parentElement;
    if (!logsCard) {
      throw new Error("Logs card not found");
    }
    const logsTable = await within(logsCard).findByRole("table");
    const logRow = await within(logsTable).findByRole("row", { name: /Veg Chili/i });
    const removeButton = within(logRow).getByRole("button", { name: "Remove" });

    await userEvent.click(removeButton);

    await waitFor(() => {
      expect(deleteLogHandler).toHaveBeenCalled();
      expect(startRequest).toHaveBeenCalled();
      expect(endRequest).toHaveBeenCalled();
    });

    expect(
      await screen.findByText(/Removed Veg Chili from the log/i),
    ).toBeInTheDocument();

    await waitFor(() => {
        expect(
          screen.getByText(
            /No items have been logged yet\. Log items to see them here\./i,
          ),
        ).toBeInTheDocument();
    });
  });
});
