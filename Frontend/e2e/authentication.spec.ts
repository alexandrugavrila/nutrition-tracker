import { expect, test } from "@playwright/test";

test("signs in through the UI and revokes access on logout", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!email || !password) throw new Error("E2E credentials are required");
  await page.goto("/data");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Ingredients", exact: true })).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(200);
  await page.getByRole("button", { name: /sign out|log out|logout/i }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
});
