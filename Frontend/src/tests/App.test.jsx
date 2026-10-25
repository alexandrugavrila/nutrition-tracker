import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, test, vi } from "vitest";

vi.mock("@/components/data/DataPage", () => ({
  __esModule: true,
  default: () => <div>DataPageComponent</div>,
}));

vi.mock("@/components/planning/Planning", () => ({
  __esModule: true,
  default: () => <div>PlanningComponent</div>,
}));

vi.mock("@/components/shopping/Shopping", () => ({
  __esModule: true,
  default: () => <div>ShoppingComponent</div>,
}));

vi.mock("@/components/cooking/Cooking", () => ({
  __esModule: true,
  default: () => <div>CookingComponent</div>,
}));

vi.mock("@/components/logging/Logging", () => ({
  __esModule: true,
  default: () => <div>LoggingComponent</div>,
}));

beforeEach(() => {
  vi.resetModules();
  window.history.pushState({}, "", "/");
});

test("renders the data page on the default route", async () => {
  const { default: App } = await import("../App");
  render(<App />);

  expect(await screen.findByText("DataPageComponent", {}, { timeout: 5000 })).toBeVisible();
  expect(screen.getByRole("button", { name: /open drawer/i })).toBeInTheDocument();
}, 10000);

test("switches routes from the navigation drawer", async () => {
  const { default: App } = await import("../App");
  render(<App />);

  expect(await screen.findByText("DataPageComponent", {}, { timeout: 5000 })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: /open drawer/i }));
  await userEvent.click(screen.getByRole("link", { name: /^Planning$/i }));
  expect(await screen.findByText("PlanningComponent")).toBeVisible();

  await userEvent.click(screen.getByRole("link", { name: /^Logging$/i }));
  expect(await screen.findByText("LoggingComponent")).toBeVisible();
}, 10000);

test("renders the current route on initial load", async () => {
  window.history.pushState({}, "", "/cooking");

  const { default: App } = await import("../App");
  render(<App />);

  expect(await screen.findByText("CookingComponent")).toBeVisible();
}, 10000);
