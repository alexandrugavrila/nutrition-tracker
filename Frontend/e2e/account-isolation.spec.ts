import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email = 'isolation-' + process.env.E2E_EMAIL!) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByLabel('Email')).toBeVisible();
}

test('account switches and reloads isolate persisted planning state and discard legacy keys', async ({
  page,
}) => {
  await page.goto('/planning');
  await page.evaluate(() => {
    sessionStorage.setItem('planning-days', '99');
    sessionStorage.setItem('ingredient-form-state-v1', 'legacy private draft');
  });
  await page.reload();
  await login(page);
  const ownerA = (await (await page.request.get('/api/auth/me')).json()).user.id;
  await expect(page.getByLabel('Days', { exact: true })).toHaveValue('1');
  await page.getByLabel('Days', { exact: true }).fill('4');
  await page.getByLabel('Days', { exact: true }).blur();
  await page.reload();
  await expect(page.getByLabel('Days', { exact: true })).toHaveValue('4');
  expect(await page.evaluate(() => sessionStorage.getItem('planning-days'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('ingredient-form-state-v1'))).toBeNull();
  await logout(page);
  await login(page, 'isolation-' + process.env.E2E_OTHER_EMAIL!);
  await expect(page.getByLabel('Days', { exact: true })).toHaveValue('1');
  const ownerB = (await (await page.request.get('/api/auth/me')).json()).user.id;
  await page.getByLabel('Days', { exact: true }).fill('2');
  await page.getByLabel('Days', { exact: true }).blur();
  await logout(page);
  await login(page);
  await expect(page.getByLabel('Days', { exact: true })).toHaveValue('4');
  const values = await page.evaluate(
    ({ ownerA, ownerB }) =>
      [ownerA, ownerB].map((id) =>
        sessionStorage.getItem(`nutrition:v2:${encodeURIComponent(id)}:planning-days`),
      ),
    { ownerA, ownerB },
  );
  expect(values).toEqual(['4', '2']);
});

test("a cookie change without a notification cannot submit the outgoing account's draft", async ({
  page,
  baseURL,
}) => {
  await page.goto('/data');
  await login(page);
  await page.getByRole('tab', { name: 'Ingredients', exact: true }).click();
  await page.getByRole('button', { name: /^Add Ingredient$/ }).click();
  const dialog = page.getByRole('dialog', { name: /^Add Ingredient/ });
  const privateName = `Private A draft ${Date.now()}`;
  await dialog.getByLabel('Name', { exact: true }).fill(privateName);
  // API login changes the shared cookie but deliberately emits no browser event.
  const changed = await page.request.post('/api/auth/login', {
    headers: { Origin: baseURL! },
    data: { email: 'isolation-' + process.env.E2E_OTHER_EMAIL, password: process.env.E2E_PASSWORD },
  });
  expect(changed.status()).toBe(200);
  const rejected = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/ingredients/') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'add ingredient', exact: true }).click();
  expect((await rejected).status()).toBe(409);
  await expect(dialog).not.toBeVisible();
  const ingredients = await (await page.request.get('/api/ingredients/')).json();
  expect(ingredients.some((item: { name: string }) => item.name === privateName)).toBe(false);
});

test('two tabs react to logout and account changes, and expired sessions remove protected content', async ({
  page,
  context,
}) => {
  await page.goto('/planning');
  await login(page);
  await page.getByLabel('Days', { exact: true }).fill('6');
  await page.getByLabel('Days', { exact: true }).blur();
  const other = await context.newPage();
  await other.goto('/planning');
  await expect(other.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();
  await logout(other);
  await expect(page.getByLabel('Email')).toBeVisible();
  await login(other, 'isolation-' + process.env.E2E_OTHER_EMAIL!);
  await page.bringToFront();
  await expect(page.getByLabel('Days', { exact: true })).toHaveValue('1');
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Days', { exact: true })).not.toBeVisible();
});
