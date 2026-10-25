import { createContext, useContext } from 'react';
import apiClient, { ApiClient } from '@/apiClient';

let generation = 0;
export function createAccountScope(userId: string, onInvalid: () => void) {
  const controller = new AbortController();
  const assertActive = () => {
    if (controller.signal.aborted) throw new DOMException('Account changed', 'AbortError');
  };
  const request: typeof fetch = async (input, options = {}) => {
    assertActive();
    const headers = new Headers(options.headers);
    headers.set('X-Account-ID', userId);
    const response = await fetch(input, {
      ...options,
      headers,
      credentials: 'include',
      signal: options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal,
    });
    assertActive();
    if (response.status === 401 || response.headers.get('X-Account-Mismatch') === '1') {
      controller.abort();
      onInvalid();
      throw new DOMException('Session changed', 'AbortError');
    }
    // Body consumption may finish after the account has already changed.
    for (const method of ['json', 'text'] as const) {
      const read = response[method].bind(response);
      response[method] = async () => {
        assertActive();
        const value = await read();
        assertActive();
        return value;
      };
    }
    return response;
  };
  return {
    userId,
    key: `${userId}:${++generation}`,
    request,
    client: new ApiClient(request),
    active: () => !controller.signal.aborted,
    invalidate: () => controller.abort(),
  };
}
export type AccountScope = ReturnType<typeof createAccountScope>;
export const AccountScopeContext = createContext<AccountScope | null>(null);
export const useAccountScope = () => useContext(AccountScopeContext);
// Isolated component tests can supply a mock client; the application always mounts a scope.
export const useAccountClient = () => useAccountScope()?.client ?? apiClient;
export const useAccountFetch = () => useAccountScope()?.request ?? fetch;
