// Production-image smoke; HTTPS by default, private HTTP only by explicit choice.
const assert = require('node:assert/strict');
function readSettings(env) {
  const origin = env.RELEASE_HTTPS_ORIGIN;
  const transport = env.RELEASE_TRANSPORT || 'https';
  assert(['https', 'http'].includes(transport), 'Unsupported smoke transport');
  assert(origin?.startsWith(transport + '://'), 'Origin must match explicit smoke transport');
  const url = new URL(origin);
  assert(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    'Supply an origin without credentials, path, query or fragment');
  const local = env.RELEASE_LOCAL_CERT === '1';
  assert(!local || transport === 'https', 'Certificate exception is only for HTTPS');
  assert(!local || new URL(origin).hostname === 'localhost', 'Local certificate exception only for localhost rehearsal');
  return { origin, transport, local };
}

async function main() {
  const { origin, transport, local } = readSettings(process.env);
  const { chromium } = require('../Frontend/node_modules/playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: local });
    const page = await context.newPage();
    await page.goto(origin);
    for (const email of [process.env.RELEASE_USER_A, process.env.RELEASE_USER_B, process.env.RELEASE_USER_A]) {
      assert(email && process.env.RELEASE_PASSWORD, 'Dedicated smoke accounts and password required');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(process.env.RELEASE_PASSWORD);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('button', { name: 'Log out', exact: true }).waitFor();
      const cookies = await context.cookies();
      const sessionCookie = cookies.find(c => c.name === 'nutrition_session');
      assert(sessionCookie && sessionCookie.httpOnly && sessionCookie.sameSite === 'Lax',
        'Named HttpOnly SameSite=Lax session cookie required');
      assert.equal(sessionCookie.secure, transport === 'https', 'Session cookie transport mismatch');
      const status = await page.evaluate(async () => (await fetch('/api/auth/me')).json());
      assert.equal(status.user.email, email);
      const rejected = await context.request.post(origin + '/api/auth/logout', {
        headers: { Origin: 'http://untrusted.example.invalid' },
      });
      assert.equal(rejected.status(), 403, 'Cross-origin cookie mutation must be rejected');
      assert.equal((await (await context.request.get(origin + '/api/auth/me')).json()).user.email,
        email, 'Rejected logout must not revoke the current session');
      const response = await context.request.get(origin + '/api/ingredients/' + process.env.RELEASE_INGREDIENT_ID);
      assert.equal(response.status(), email === process.env.RELEASE_USER_A ? 200 : 404);
      await page.reload();
      await page.getByRole('button', { name: 'Log out', exact: true }).click();
      await page.getByLabel('Email').waitFor();
      assert.equal((await context.request.get(origin + '/api/ingredients/')).status(), 401);
    }
    await context.close();
    console.log(`${transport.toUpperCase()} browser smoke passed: cookie flags, login, origin rejection, reload, A/B/A isolation, logout.`);
  } finally { await browser.close(); }
}
module.exports = { readSettings };
if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
