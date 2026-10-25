import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { DataProvider, useData } from "@/contexts/DataContext";

const createResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("DataProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <DataProvider>{children}</DataProvider>
  );

  it("hydrates fridge inventory during initial load", async () => {
    const storedFoodResponse = [
      {
        id: "7",
        label: "Veggie Chili",
        user_id: "demo-user",
        food_id: 5,
        ingredient_id: null,
        prepared_portions: "4",
        remaining_portions: "3",
        per_portion_calories: "250",
        per_portion_protein: "20",
        per_portion_carbohydrates: "30",
        per_portion_fat: "10",
        per_portion_fiber: "5",
        is_finished: false,
        prepared_at: "2024-01-01T00:00:00+00:00",
        updated_at: "2024-01-01T01:00:00+00:00",
        completed_at: null,
      },
    ];

    const responses: Record<string, Response> = {
      "/api/ingredients/": createResponse([]),
      "/api/foods/": createResponse([]),
      "/api/stored_food/": createResponse(storedFoodResponse),
      "/api/ingredients/possible_tags": createResponse([]),
      "/api/foods/possible_tags": createResponse([]),
    };

    const fetchMock = vi
      .fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          typeof input === "string"
            ? new Request(
                input.startsWith("http") ? input : `http://localhost${input}`,
                init,
              )
            : input instanceof Request
            ? input
            : new Request(input);
        const url = new URL(request.url);
        const response = responses[url.pathname];
        if (!response) {
          throw new Error(`Unexpected fetch to ${url.pathname}`);
        }
        return response.clone();
      }) as unknown as typeof fetch;

    global.fetch = fetchMock;

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.hydrated).toBe(true));

    expect(result.current.fridgeInventory).toEqual([
      {
        id: 7,
        label: "Veggie Chili",
        user_id: "demo-user",
        food_id: 5,
        ingredient_id: null,
        prepared_portions: 4,
        remaining_portions: 3,
        per_portion_calories: 250,
        per_portion_protein: 20,
        per_portion_carbohydrates: 30,
        per_portion_fat: 10,
        per_portion_fiber: 5,
        is_finished: false,
        prepared_at: "2024-01-01T00:00:00+00:00",
        updated_at: "2024-01-01T01:00:00+00:00",
        completed_at: null,
      },
    ]);
  });

  it("refetches fridge data when invalidated", async () => {
    const storedFoodResponse = [
      {
        id: 1,
        label: "Batch",
        user_id: "demo-user",
        food_id: null,
        ingredient_id: 10,
        prepared_portions: 2,
        remaining_portions: 1,
        per_portion_calories: 120,
        per_portion_protein: 15,
        per_portion_carbohydrates: 18,
        per_portion_fat: 6,
        per_portion_fiber: 7,
        is_finished: false,
        prepared_at: "2024-01-02T00:00:00+00:00",
        updated_at: "2024-01-02T00:00:00+00:00",
        completed_at: null,
      },
    ];

    let storedFoodHits = 0;
    const responses: Record<string, Response> = {
      "/api/ingredients/": createResponse([]),
      "/api/foods/": createResponse([]),
      "/api/stored_food/": createResponse(storedFoodResponse),
      "/api/ingredients/possible_tags": createResponse([]),
      "/api/foods/possible_tags": createResponse([]),
    };

    const fetchMock = vi
      .fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          typeof input === "string"
            ? new Request(
                input.startsWith("http") ? input : `http://localhost${input}`,
                init,
              )
            : input instanceof Request
            ? input
            : new Request(input);
        const url = new URL(request.url);
        if (url.pathname === "/api/stored_food/") {
          storedFoodHits += 1;
        }
        const response = responses[url.pathname];
        if (!response) {
          throw new Error(`Unexpected fetch to ${url.pathname}`);
        }
        return response.clone();
      }) as unknown as typeof fetch;

    global.fetch = fetchMock;

    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(storedFoodHits).toBe(1);

    await act(async () => {
      result.current.setFridgeNeedsRefetch(true);
    });

    await waitFor(() => expect(storedFoodHits).toBe(2));
    expect(result.current?.fridgeInventory[0]?.remaining_portions).toBe(1);
  });
});
