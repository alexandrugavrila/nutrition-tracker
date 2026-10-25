import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountScopeContext, createAccountScope } from '@/contexts/AccountScope';
import { useSessionStorageState, useSessionStorageReducer } from '@/hooks/useSessionStorageState';
import { storageKey, clearLegacyStorage } from '@/utils/accountStorage';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

const savedFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = savedFetch;
  vi.restoreAllMocks();
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const wrapper =
  (scope: ReturnType<typeof createAccountScope>) =>
  ({ children }: { children: React.ReactNode }) => (
    <AccountScopeContext.Provider value={scope}>{children}</AccountScopeContext.Provider>
  );

it('keeps all workflow keys private through A to B to A, reloads, and stale callbacks', () => {
  const fixtures: [string, unknown, unknown][] = [
    ['planning-days', 1, 4],
    ['planning-save-label', '', 'A private draft'],
    [
      'planning-plan',
      [],
      [{ type: 'ingredient', ingredientId: '1', unitId: 0, amount: 5, portions: 1 }],
    ],
    [
      'planning-active-plan',
      { id: null, label: null, updatedAt: null },
      { id: 1, label: 'A plan', updatedAt: null },
    ],
    [
      'planning-target-macros',
      { calories: 0, protein: 0, fat: 0, carbohydrates: 0, fiber: 0 },
      { calories: 123, protein: 1, fat: 2, carbohydrates: 3, fiber: 4 },
    ],
    ['planning-include-fridge', false, true],
    ['planning-open-state', {}, { '1': true }],
    ['shopping-excluded-items', {}, { 'ingredient:1': true }],
    [
      'cooking-actuals',
      { portions: {}, ingredientTotals: {}, foodAdjustments: {} },
      { portions: { '1': 2 }, ingredientTotals: {}, foodAdjustments: {} },
    ],
    ['cooking-completed-plan-keys', [], ['A plan key']],
    ['ingredient-form-open', false, true],
    ['ingredient-form-edit-mode', false, true],
    [
      'ingredient-form-state-v1',
      { ingredient: { id: 'draft', name: '', units: [], tags: [] } },
      { ingredient: { id: 123, name: 'A ingredient', units: [{ name: 'g', grams: 1 }], tags: [] } },
    ],
    [
      'food-form-state-v1',
      { foodToEdit: { id: 'draft', name: '', ingredients: [], tags: [] } },
      { foodToEdit: { id: 123, name: 'A food', ingredients: [], tags: [] } },
    ],
  ];
  for (const [name, base, privateValue] of fixtures) {
    const a = createAccountScope('A', vi.fn());
    const first = renderHook(() => useSessionStorageState(name, base), { wrapper: wrapper(a) });
    act(() => first.result.current[1](privateValue));
    const stale = first.result.current[1];
    a.invalidate();
    first.unmount();
    const b = createAccountScope('B', vi.fn());
    const second = renderHook(() => useSessionStorageState(name, base), { wrapper: wrapper(b) });
    expect(second.result.current[0]).toEqual(base);
    act(() => stale(base));
    second.unmount();
    const third = renderHook(() => useSessionStorageState(name, base), {
      wrapper: wrapper(createAccountScope('A', vi.fn())),
    });
    expect(third.result.current[0]).toEqual(privateValue);
    expect(sessionStorage.getItem(storageKey('B', name))).toBe(JSON.stringify(base));
    third.unmount();
  }
});

it('removes legacy keys without migrating unknown ownership or touching unrelated storage', () => {
  for (const storage of [sessionStorage, localStorage]) {
    storage.setItem('planning-plan', 'private legacy data');
    storage.setItem('ingredient-form-state-v1', 'private legacy draft');
    storage.setItem('unrelated', 'keep');
    storage.setItem(storageKey('A', 'planning-days'), '3');
  }
  clearLegacyStorage();
  for (const storage of [sessionStorage, localStorage]) {
    expect(storage.getItem('planning-plan')).toBeNull();
    expect(storage.getItem('ingredient-form-state-v1')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
    expect(storage.getItem(storageKey('A', 'planning-days'))).toBe('3');
  }
});

it.each(['null', '{}', '[null]', 'not-json'])('discards corrupt plan storage %s', (value) => {
  sessionStorage.setItem(storageKey('A', 'planning-plan'), value);
  const hook = renderHook(() => useSessionStorageState('planning-plan', () => []), {
    wrapper: wrapper(createAccountScope('A', vi.fn())),
  });
  expect(hook.result.current[0]).toEqual([]);
});

it('never persists anonymous state and tolerates denied storage', () => {
  const noAccount = renderHook(() => useSessionStorageState('planning-days', 1));
  act(() => noAccount.result.current[1](8));
  expect(sessionStorage.length).toBe(0);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  const scoped = renderHook(() => useSessionStorageState('planning-days', 1), {
    wrapper: wrapper(createAccountScope('A', vi.fn())),
  });
  expect(scoped.result.current[0]).toBe(1);
});

it('rejects late responses and follow-up writes using an invalidated account', async () => {
  let release!: (response: Response) => void;
  const request = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  globalThis.fetch = request;
  const a = createAccountScope('A', vi.fn());
  const pending = a.request('/api/ingredients/');
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('X-Account-ID')).toBe('A');
  a.invalidate();
  release(json([{ name: 'A secret' }]));
  await rejected;
  await expect(a.request('/api/plans/', { method: 'POST', body: 'A draft' })).rejects.toMatchObject(
    { name: 'AbortError' },
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it('rejects a body that finishes after identity invalidation', async () => {
  let release!: (value: unknown) => void;
  const response = json({});
  response.json = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  globalThis.fetch = vi.fn(async () => response);
  const scope = createAccountScope('A', vi.fn());
  const received = await scope.request('/api/ingredients/');
  const pending = received.json();
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  scope.invalidate();
  release({ secret: 'A' });
  await rejected;
});

it.each([401, 409])('invalidates protected state on session status %s', async (status) => {
  const invalidate = vi.fn();
  globalThis.fetch = vi.fn(
    async () =>
      new Response(null, { status, headers: status === 409 ? { 'X-Account-Mismatch': '1' } : {} }),
  );
  const scope = createAccountScope('A', invalidate);
  await expect(scope.request('/api/plans/')).rejects.toMatchObject({ name: 'AbortError' });
  expect(scope.active()).toBe(false);
  expect(invalidate).toHaveBeenCalledOnce();
});

function Identity() {
  const { user, loading, scope } = useAuth();
  if (loading) return <div>Checking identity</div>;
  if (!user || !scope) return <div>Signed out</div>;
  return (
    <AccountScopeContext.Provider value={scope} key={scope.key}>
      <Draft user={user.id} />
    </AccountScopeContext.Provider>
  );
}
function Draft({ user }: { user: string }) {
  const [draft, setDraft] = useSessionStorageState('planning-save-label', '');
  return (
    <div>
      <span>{user}</span>
      <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    </div>
  );
}
it('hides protected content during focus checks, ignores out-of-order checks, and fails closed', async () => {
  const replies: ((response: Response) => void)[] = [];
  globalThis.fetch = vi.fn(() => new Promise<Response>((resolve) => replies.push(resolve)));
  render(
    <AuthProvider>
      <Identity />
    </AuthProvider>,
  );
  await act(async () => replies.shift()!(json({ authenticated: true, user: { id: 'A' } })));
  expect(screen.getByText('A')).toBeVisible();
  act(() => window.dispatchEvent(new Event('focus')));
  expect(screen.queryByText('A')).toBeNull();
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'nutrition:session-change' })));
  const stale = replies.shift()!,
    current = replies.shift()!;
  await act(async () => current(json({ authenticated: true, user: { id: 'B' } })));
  await act(async () => stale(json({ authenticated: true, user: { id: 'A' } })));
  expect(screen.getByText('B')).toBeVisible();
  expect(screen.queryByText('A')).toBeNull();
  act(() => window.dispatchEvent(new Event('focus')));
  await act(async () => replies.shift()!(json({}, 503)));
  expect(screen.getByText('Signed out')).toBeVisible();
});

it('invalidated reducer callbacks cannot rewrite an outgoing draft', () => {
  const scope = createAccountScope('A', vi.fn());
  const hook = renderHook(
    () =>
      useSessionStorageReducer(
        (state: { name: string }, name: string) => ({ name }),
        () => ({ name: 'saved' }),
        'draft',
      ),
    { wrapper: wrapper(scope) },
  );
  act(() => hook.result.current[1]("A's draft"));
  scope.invalidate();
  act(() => hook.result.current[1]('late response'));
  expect(sessionStorage.getItem(storageKey('A', 'draft'))).toBe(
    JSON.stringify({ name: "A's draft" }),
  );
});

it('the parsed API client also rejects stale body completion', async () => {
  let release!: (value: unknown) => void;
  const response = json({});
  response.json = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  globalThis.fetch = vi.fn(async () => response);
  const scope = createAccountScope('A', vi.fn());
  const pending = scope.client.path('/api/plans/').method('get').create()();
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await waitFor(() => expect(release).toBeDefined());
  scope.invalidate();
  release({ secret: 'A' });
  await rejected;
});
