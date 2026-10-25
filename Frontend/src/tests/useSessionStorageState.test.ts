import React from "react";
import { AccountScopeContext, createAccountScope } from "@/contexts/AccountScope";
import { storageKey } from "@/utils/accountStorage";
import { act, renderHook as renderBaseHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useSessionStorageReducer,
  useSessionStorageState,
} from "../hooks/useSessionStorageState";

type SessionState = { count: number; label: string };
type SessionAction = { type: "increment" };

const KEY = storageKey("test-user", "test-key");
const scope = createAccountScope("test-user", () => {});
function renderHook<T>(callback: () => T) {
  return renderBaseHook(callback, { wrapper: ({ children }) => React.createElement(AccountScopeContext.Provider, {value:scope}, children) });
}

const originalSessionStorageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "sessionStorage",
);

let storageStore: Record<string, string>;

beforeEach(() => {
  storageStore = {};

  const storageMock = {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(storageStore, key)
        ? storageStore[key]
        : null;
    },
    setItem(key: string, value: string) {
      storageStore[key] = value;
    },
    removeItem(key: string) {
      delete storageStore[key];
    },
    clear() {
      storageStore = {};
    },
    key(index: number) {
      return Object.keys(storageStore)[index] ?? null;
    },
  } as Storage;

  Object.defineProperty(storageMock, "length", {
    get: () => Object.keys(storageStore).length,
  });

  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: storageMock,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalSessionStorageDescriptor) {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      ...originalSessionStorageDescriptor,
    });
  } else {
    delete (window as { sessionStorage?: Storage }).sessionStorage;
  }
});

describe("useSessionStorageState", () => {
  it("initializes from defaults when nothing is persisted", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    const { result } = renderHook(() => useSessionStorageState("test-key", { count: 0 }));

    expect(result.current[0]).toEqual({ count: 0 });
    expect(warnSpy).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(storageStore[KEY]).toEqual(JSON.stringify({ count: 0 })),
    );
  });

  it("prefers persisted sessionStorage values over defaults", () => {
    storageStore[KEY] = JSON.stringify({ count: 42 });

    const { result } = renderHook(() => useSessionStorageState("test-key", { count: 0 }));

    expect(result.current[0]).toEqual({ count: 42 });
  });

  it("supports functional updates and persists the result", async () => {
    const setItemSpy = vi.spyOn(window.sessionStorage, "setItem");
    const { result } = renderHook(() => useSessionStorageState("test-key", 0));

    await waitFor(() => expect(storageStore[KEY]).toEqual(JSON.stringify(0)));

    act(() => {
      result.current[1]((prev) => prev + 1);
    });

    expect(result.current[0]).toBe(1);

    await waitFor(() => expect(storageStore[KEY]).toEqual(JSON.stringify(1)));
    expect(setItemSpy.mock.calls.at(-1)).toEqual([KEY, JSON.stringify(1)]);
  });

  it("falls back to defaults when persisted data cannot be parsed", async () => {
    storageStore[KEY] = "not-json";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const removeSpy = vi.spyOn(window.sessionStorage, "removeItem");

    const { result } = renderHook(() => useSessionStorageState("test-key", "fallback"));

    expect(result.current[0]).toBe("fallback");
    expect(removeSpy).toHaveBeenCalledWith(KEY);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain(
      `Failed to parse sessionStorage key "${KEY}"`,
    );
    expect(warnSpy.mock.calls[0]?.[1]).toBeInstanceOf(SyntaxError);

    await waitFor(() => expect(storageStore[KEY]).toEqual(JSON.stringify("fallback")));
  });
});

describe("useSessionStorageReducer", () => {
  const createInitialState = () => ({
    count: 0,
    label: "base",
  });

  const reducer = (state: SessionState, action: SessionAction): SessionState => {
    switch (action.type) {
      case "increment":
        return { ...state, count: state.count + 1 };
      default:
        return state;
    }
  };

  it("merges persisted partial state with freshly created defaults", () => {
    storageStore[KEY] = JSON.stringify({ count: 5 });

    const { result } = renderHook(() =>
      useSessionStorageReducer(reducer, createInitialState, "test-key"),
    );

    expect(result.current[0]).toEqual({ count: 5, label: "base" });
  });

  it("persists new state when the reducer dispatches", async () => {
    const setItemSpy = vi.spyOn(window.sessionStorage, "setItem");

    const { result } = renderHook(() =>
      useSessionStorageReducer(reducer, createInitialState, "test-key"),
    );

    await waitFor(() =>
      expect(storageStore[KEY]).toEqual(JSON.stringify({ count: 0, label: "base" })),
    );

    const initialCallCount = setItemSpy.mock.calls.length;

    act(() => {
      result.current[1]({ type: "increment" });
    });

    expect(result.current[0]).toEqual({ count: 1, label: "base" });

    await waitFor(() =>
      expect(storageStore[KEY]).toEqual(JSON.stringify({ count: 1, label: "base" })),
    );

    await waitFor(() =>
      expect(setItemSpy.mock.calls.length).toBeGreaterThan(initialCallCount),
    );
    expect(setItemSpy.mock.calls.at(-1)).toEqual([
      KEY,
      JSON.stringify({ count: 1, label: "base" }),
    ]);
  });
});
