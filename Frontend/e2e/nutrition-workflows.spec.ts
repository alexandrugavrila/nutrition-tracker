import { expect, test, type Locator, type Page } from "@playwright/test";

const runId = `${Date.now()}`;

const manualIngredientName = `E2E Manual Ingredient ${runId}`;
const usdaIngredientName = "E2E USDA Ingredient";
const foodName = `E2E Food ${runId}`;
const planName = `E2E Plan ${runId}`;

const USDA_DEFAULT_UNIT_NAME = "medium";

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getTitledDialog = (page: Page, title: string): Locator =>
  page.getByRole("dialog", {
    name: new RegExp(`^${escapeRegex(title)}(?:\\s+close)?$`),
  });

const getTableDialog = (page: Page, heading: "Foods" | "Ingredients"): Locator =>
  page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: heading, exact: true }),
  });

const getPreferredShoppingUnit = (dialog: Locator): Locator =>
  dialog.getByRole("combobox", { name: "Preferred shopping unit" });

const getDataPanel = (page: Page, name: "Foods" | "Ingredients"): Locator =>
  page.getByRole("tabpanel", { name });

const roundForUi = (value: number): string => {
  const rounded = Number.parseFloat(value.toPrecision(3));
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

async function gotoDataTab(page: Page, tabName: "Foods" | "Ingredients"): Promise<void> {
  await page.goto("/data");
  await expect(page.getByRole("tab", { name: tabName })).toBeVisible();
  await page.getByRole("tab", { name: tabName }).click();
  await expect(page.getByRole("heading", { name: tabName })).toBeVisible();
}

async function navigateWithDrawer(page: Page, destination: "Shopping" | "Cooking" | "Logging"): Promise<void> {
  const openDrawerButton = page.getByRole("button", { name: "open drawer" });
  if (await openDrawerButton.isVisible()) {
    await openDrawerButton.click();
  }
  await page.getByRole("link", { name: destination }).click();
  const headingName = destination === "Shopping" ? "Shopping List" : destination;
  await expect(page.getByRole("heading", { name: headingName })).toBeVisible();
}

async function chooseOption(trigger: Locator, page: Page, optionName: string): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

async function addManualIngredient(page: Page): Promise<void> {
  await gotoDataTab(page, "Ingredients");

  await page.getByRole("button", { name: /^Add Ingredient$/ }).click();
  const dialog = getTitledDialog(page, "Add Ingredient");

  await dialog.getByLabel("Name").fill(manualIngredientName);
  await dialog.getByRole("button", { name: "add ingredient unit" }).click();

  const unitDialog = getTitledDialog(page, "Add Unit");
  await unitDialog.getByLabel("Unit name").fill("cup");
  await unitDialog.getByLabel("Unit grams").fill("100");
  await unitDialog.getByRole("button", { name: /^Add$/ }).click();
  await expect(unitDialog).toBeHidden();

  await chooseOption(getPreferredShoppingUnit(dialog), page, "g");
  await dialog.getByLabel("Calories").fill("2");
  await dialog.getByLabel("Protein").fill("0.5");
  await dialog.getByLabel("Carbs").fill("0.25");
  await dialog.getByLabel("Fat").fill("0.1");
  await dialog.getByLabel("Fiber").fill("0.05");
  await chooseOption(getPreferredShoppingUnit(dialog), page, "cup");

  await dialog.getByRole("button", { name: "add ingredient", exact: true }).click();
  await expect(dialog).toBeHidden();

  const ingredientRow = page.getByRole("row", { name: new RegExp(manualIngredientName) });
  await expect(ingredientRow).toContainText("cup");
  await expect(ingredientRow).toContainText("200");
}

async function addUsdaIngredient(page: Page): Promise<void> {
  await gotoDataTab(page, "Ingredients");

  await page.getByRole("button", { name: /^Add Ingredient$/ }).click();
  const dialog = getTitledDialog(page, "Add Ingredient");

  await chooseOption(dialog.getByLabel("Source"), page, "USDA");
  await dialog.getByLabel("Search USDA").fill("banana");
  await dialog.getByRole("button", { name: "Search" }).click();
  await dialog.getByRole("button", { name: new RegExp(usdaIngredientName) }).click();

  await expect(dialog.getByLabel("Name")).toHaveValue(usdaIngredientName);
  await expect(dialog.getByText(/USDA-sourced nutrition is read-only/i)).toBeVisible();

  await expect(getPreferredShoppingUnit(dialog)).toContainText(USDA_DEFAULT_UNIT_NAME);
  await expect(dialog.getByLabel("Calories")).toHaveValue("50");

  await dialog.getByRole("button", { name: "add ingredient", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function searchIngredient(page: Page, ingredientName: string): Promise<Locator> {
  const ingredientPanel = getDataPanel(page, "Ingredients");
  const search = ingredientPanel.getByLabel("Search by name");
  await search.fill(ingredientName);
  const row = ingredientPanel.getByRole("row", { name: new RegExp(ingredientName) });
  await expect(row).toBeVisible();
  return row;
}

async function reopenIngredient(page: Page, ingredientName: string): Promise<Locator> {
  const row = await searchIngredient(page, ingredientName);
  await row.getByRole("button", { name: `Edit ingredient ${ingredientName}` }).click();
  return getTitledDialog(page, "Edit Ingredient");
}

async function addFood(page: Page): Promise<void> {
  await gotoDataTab(page, "Foods");

  await page.getByRole("button", { name: /^Add Food$/ }).click();
  const form = getDataPanel(page, "Foods");

  await form.getByLabel("Name", { exact: true }).fill(foodName);
  await form.getByLabel("Recipe yields").fill("5");
  await form.getByRole("button", { name: "Add Ingredients" }).click();

  const ingredientDialog = getTableDialog(page, "Ingredients");
  await ingredientDialog.getByLabel("Search by name").fill(manualIngredientName);
  await ingredientDialog.getByRole("button", { name: `Select ingredient ${manualIngredientName}` }).click();
  await expect(ingredientDialog).toBeHidden();

  await form.getByRole("button", { name: "Add Ingredients" }).click();
  const secondIngredientDialog = getTableDialog(page, "Ingredients");
  await secondIngredientDialog.getByLabel("Search by name").fill(usdaIngredientName);
  await secondIngredientDialog.getByRole("button", { name: `Select ingredient ${usdaIngredientName}` }).click();
  await expect(secondIngredientDialog).toBeHidden();

  const manualRow = form.getByRole("row", { name: new RegExp(manualIngredientName) });
  const usdaRow = form.getByRole("row", { name: new RegExp(usdaIngredientName) });

  await manualRow.getByRole("spinbutton").fill("2");
  await usdaRow.getByRole("spinbutton").fill("3");

  await form.getByRole("button", { name: "add food", exact: true }).click();
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue("");
}

async function reopenFood(page: Page): Promise<void> {
  await gotoDataTab(page, "Foods");
  const foodPanel = getDataPanel(page, "Foods");
  await foodPanel.getByLabel("Search by name").fill(foodName);
  const row = foodPanel.getByRole("row", { name: new RegExp(foodName) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Edit food ${foodName}` }).click();
}

async function fetchFood(page: Page): Promise<{ ingredients: Array<{ unit_quantity: number }> }> {
  const response = await page.request.get("/api/foods/");
  expect(response.ok()).toBeTruthy();
  const foods = (await response.json()) as Array<{ name: string; ingredients: Array<{ unit_quantity: number }> }>;
  const food = foods.find((entry) => entry.name === foodName);
  expect(food).toBeDefined();
  return food!;
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error("E2E_EMAIL and E2E_PASSWORD are required");
  const response = await page.request.post("/api/auth/login", { headers: { Origin: new URL(process.env.PLAYWRIGHT_BASE_URL!).origin }, data: { email, password } });
  expect(response.status()).toBe(200);
});

test("creates a manual ingredient with units and a preferred shopping unit", async ({ page }) => {
  await addManualIngredient(page);

  const dialog = await reopenIngredient(page, manualIngredientName);
  await expect(dialog.getByLabel("Name")).toHaveValue(manualIngredientName);
  await expect(getPreferredShoppingUnit(dialog)).toContainText("cup");
  await expect(dialog.getByLabel("Calories")).toHaveValue("200");
  await dialog.getByRole("button", { name: "close" }).click();
});

test("imports a USDA ingredient and reloads the saved default unit and per-gram nutrition", async ({ page }) => {
  await addUsdaIngredient(page);

  const dialog = await reopenIngredient(page, usdaIngredientName);
  await expect(dialog.getByLabel("Source")).toContainText("USDA");
  await expect(getPreferredShoppingUnit(dialog)).toContainText(USDA_DEFAULT_UNIT_NAME);

  await expect(dialog.getByRole("button", { name: "update ingredient", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Name")).toBeDisabled();
  await dialog.getByRole("button", { name: "Make a personal copy to edit" }).click();
  await expect(dialog.getByLabel("Name")).toBeEnabled();
  await chooseOption(getPreferredShoppingUnit(dialog), page, "g");
  await expect(dialog.getByLabel("Calories")).toHaveValue("1");
  await expect(dialog.getByLabel("Protein")).toHaveValue("0.2");
  await dialog.getByLabel("Name").fill("E2E Personal USDA Copy");
  await dialog.getByRole("button", { name: "update ingredient", exact: true }).click();
  await expect(dialog).toBeHidden();
  const original = await reopenIngredient(page, usdaIngredientName);
  await expect(original.getByLabel("Name")).toBeDisabled();
});

test("creates a food with recipe yield normalization and reloads persisted ingredient quantities", async ({ page }) => {
  await addFood(page);
  await reopenFood(page);

  const foodPanel = getDataPanel(page, "Foods");

  const manualRow = foodPanel.getByRole("row", { name: new RegExp(manualIngredientName) });
  const usdaRow = foodPanel.getByRole("row", { name: new RegExp(usdaIngredientName) });

  await expect(foodPanel.getByLabel("Recipe yields")).toHaveValue("1");
  await expect(manualRow.getByRole("spinbutton")).toHaveValue("0.4");
  await expect(usdaRow.getByRole("spinbutton")).toHaveValue("0.6");

  const persistedFood = await fetchFood(page);
  expect(persistedFood.ingredients.map((ingredient) => ingredient.unit_quantity)).toEqual([0.4, 0.6]);
});

test("plans, shops, cooks, logs, and preserves daily totals after deleting the stored batch", async ({ page }) => {
  await page.goto("/planning");
  await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();

  await page.getByRole("button", { name: "Add Food" }).click();
  const foodDialog = getTableDialog(page, "Foods");
  await foodDialog.getByLabel("Search by name").fill(foodName);
  await foodDialog.getByRole("button", { name: `Select food ${foodName}` }).click();
  await expect(foodDialog).toBeHidden();

  await page.getByRole("button", { name: "Add Ingredient" }).click();
  const ingredientDialog = getTableDialog(page, "Ingredients");
  await ingredientDialog.getByLabel("Search by name").fill(manualIngredientName);
  await ingredientDialog.getByRole("button", { name: `Select ingredient ${manualIngredientName}` }).click();
  await expect(ingredientDialog).toBeHidden();

  const foodRow = page.getByRole("row", { name: new RegExp(foodName) });
  const ingredientRow = page.getByRole("row", { name: new RegExp(manualIngredientName) });

  await foodRow.getByRole("spinbutton").fill("1");
  await chooseOption(ingredientRow.getByRole("combobox"), page, "cup");
  await ingredientRow.getByLabel("planned portions").fill("2");

  const summary = page.locator("table").filter({ has: page.getByText("Total Overall") }).first();
  await expect(summary.getByRole("row", { name: /Total Overall/ })).toContainText("510");
  await expect(summary.getByRole("row", { name: /Per Day/ })).toContainText("510");

  await page.getByRole("button", { name: "Save Plan" }).click();
  const saveDialog = getTitledDialog(page, "Save Plan");
  await saveDialog.getByLabel("Plan name").fill(planName);
  await saveDialog.getByRole("button", { name: "Save as New" }).click();
  await expect(saveDialog).toBeHidden();
  await expect(page.getByText(`Saved plan "${planName}"`, { exact: true })).toBeVisible();

  await navigateWithDrawer(page, "Shopping");
  const shoppingManualRow = page.getByRole("row", { name: new RegExp(manualIngredientName) });
  const shoppingUsdaRow = page.getByRole("row", { name: new RegExp(usdaIngredientName) });

  await expect(shoppingManualRow).toContainText("cup");
  await expect(shoppingManualRow).toContainText(roundForUi(2.4));
  await expect(shoppingUsdaRow).toContainText(USDA_DEFAULT_UNIT_NAME);
  await expect(shoppingUsdaRow).toContainText("0.6");

  await navigateWithDrawer(page, "Cooking");
  const cookingFoodRow = page.getByRole("row", { name: new RegExp(foodName) });
  await cookingFoodRow.getByRole("button", { name: "Mark complete", exact: true }).click();

  await navigateWithDrawer(page, "Logging");
  const fridgeTable = page.getByRole("table").filter({
    has: page.getByRole("columnheader", { name: "Remaining portions" }),
  });
  const fridgeRow = fridgeTable.getByRole("row", { name: new RegExp(foodName) });
  await expect(fridgeRow).toContainText("1");

  await fridgeRow.getByLabel(`Portions to log for ${foodName}`).fill("0.5");
  await fridgeRow.getByRole("button", { name: "Add to log", exact: true }).click();

  await expect(fridgeRow).toContainText("0.5");
  const dailyTotal = page.getByRole("group", { name: /Daily Total/i });
  await expect(dailyTotal.getByLabel("Total calories")).toHaveText("55");
  await expect(dailyTotal.getByLabel("Total protein")).toHaveText("13");
  await expect(dailyTotal.getByLabel("Total carbs")).toHaveText("9.5");
  await expect(dailyTotal.getByLabel("Total fat")).toHaveText("2.75");
  await expect(dailyTotal.getByLabel("Total fiber")).toHaveText("2.5");

  await fridgeRow.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(fridgeRow).toHaveCount(0);
  await expect(dailyTotal.getByLabel("Total calories")).toHaveText("55");
  await expect(page.getByRole("row", { name: /Entry from .* 0\.5 55/ })).toBeVisible();
});


test("preserves unavailable nutrients from USDA through recipe, cooking and logging", async ({ page }) => {
  const name = "E2E Incomplete USDA";
  const recipeName = `Incomplete recipe ${runId}`;
  await gotoDataTab(page, "Ingredients");
  await page.getByRole("button", { name: /^Add Ingredient$/ }).click();
  const dialog = getTitledDialog(page, "Add Ingredient");
  await chooseOption(dialog.getByLabel("Source"), page, "USDA");
  await dialog.getByLabel("Search USDA").fill("incomplete");
  await dialog.getByRole("button", { name: "Search" }).click();
  await expect(dialog.getByRole("button", { name: new RegExp(name) })).toContainText("Unavailable");
  await dialog.getByRole("button", { name: new RegExp(name) }).click();
  await expect(dialog.getByLabel("Fiber")).toHaveValue("");
  await expect(dialog.getByLabel("Fat")).toHaveValue("0");
  await dialog.getByRole("button", { name: "add ingredient", exact: true }).click();
  await expect(dialog).toBeHidden();
  const ingredientRow = await searchIngredient(page, name);
  await expect(ingredientRow).toContainText("Unavailable");
  const ingredients = await (await page.request.get("/api/ingredients/")).json();
  const ingredient = ingredients.find((item) => item.name === name);
  const gram = ingredient.units.find((unit) => unit.grams === 1);
  const response = await page.request.post("/api/foods/", {
    headers: { Origin: new URL(process.env.PLAYWRIGHT_BASE_URL!).origin },
    data: { name: recipeName, ingredients: [{ ingredient_id: ingredient.id, unit_id: gram.id, unit_quantity: 50 }] },
  });
  expect(response.status()).toBe(201);
  await page.goto("/planning");
  await page.getByRole("button", { name: "Add Food" }).click();
  const foods = getTableDialog(page, "Foods");
  await foods.getByLabel("Search by name").fill(recipeName);
  await foods.getByRole("button", { name: `Select food ${recipeName}` }).click();
  await expect(page.getByRole("row", { name: /Total Overall/ })).toContainText("Unavailable");
  await navigateWithDrawer(page, "Cooking");
  const cooked = page.getByRole("row", { name: new RegExp(recipeName) });
  await expect(cooked).toContainText("Unavailable");
  await cooked.getByRole("button", { name: "Mark complete", exact: true }).click();
  const batches = await (await page.request.get("/api/stored_food/")).json();
  const batch = batches.find((item) => item.label === recipeName);
  expect(batch.per_portion_fiber).toBeNull();
  expect(batch.per_portion_fat).toBe(0);
  await navigateWithDrawer(page, "Logging");
  const fridgeRow = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Remaining portions" }) })
    .getByRole("row", { name: new RegExp(recipeName) });
  await fridgeRow.getByRole("button", { name: "Add to log", exact: true }).click();
  const dailyTotal = page.getByRole("group", { name: /Daily Total/i });
  await expect(dailyTotal.getByLabel("Total fiber")).toHaveText("Unavailable");
  await page.reload();
  await expect(page.getByRole("group", { name: /Daily Total/i }).getByLabel("Total fiber")).toHaveText("Unavailable");
});
