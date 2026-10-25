import '@testing-library/jest-dom/vitest';
import { vi, beforeEach } from 'vitest';

beforeEach(() => {
  window.sessionStorage.clear();
});

// Provide a simple fetch mock so tests don't hit the network.
vi.stubGlobal(
  'fetch',
  (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/me')) {
      return new Response(
        JSON.stringify({
          authenticated: true,
          user: {
            id: 'user-1',
            email: 'user@example.com',
            display_name: 'Test User',
            is_active: true,
            is_admin: false,
            last_login_at: null,
            created_at: '2026-04-19T00:00:00Z',
            updated_at: '2026-04-19T00:00:00Z',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch,
);

// Silence React act() warnings from third-party components to keep test
// output focused on actionable errors.
const error = console.error;
vi.spyOn(console, 'error').mockImplementation((msg, ...args) => {
  if (typeof msg === 'string' && msg.includes('not wrapped in act')) {
    return;
  }
  error(msg, ...args);
});
