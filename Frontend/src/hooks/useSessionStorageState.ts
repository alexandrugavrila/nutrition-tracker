import { useAccountScope } from '@/contexts/AccountScope';
import { storageKey, compatible, validWorkflow } from '@/utils/accountStorage';
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Reducer,
  type SetStateAction,
} from 'react';

const isBrowser = typeof window !== 'undefined';

const readFromSessionStorage = <T>(key: string | null): T | undefined => {
  if (!isBrowser || !key) return undefined;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`Failed to parse sessionStorage key "${key}".`, error);
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // ignore removal errors
    }
    return undefined;
  }
};

const writeToSessionStorage = <T>(key: string | null, value: T) => {
  if (!isBrowser || !key) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to persist sessionStorage key "${key}".`, error);
  }
};

export function useSessionStorageState<T>(storageName: string, initialState: T | (() => T)) {
  const scope = useAccountScope();
  const key = scope ? storageKey(scope.userId, storageName) : '';
  const resolveInitialState = useCallback((): T => {
    const persisted = readFromSessionStorage<T>(key);
    const base = typeof initialState === 'function' ? (initialState as () => T)() : initialState;
    return persisted !== undefined && compatible(persisted, base) && validWorkflow(key, persisted)
      ? persisted
      : base;
  }, [initialState, key]);

  const [state, setState] = useState<T>(resolveInitialState);

  const setPersistedState = useCallback(
    (value: SetStateAction<T>) => {
      if (scope && !scope.active()) return;
      setState((prev) =>
        typeof value === 'function' ? (value as (previous: T) => T)(prev) : value,
      );
    },
    [scope],
  );

  useEffect(() => {
    if (scope?.active()) writeToSessionStorage(key, state);
  }, [key, state, scope]);

  return [state, setPersistedState] as const;
}

export function useSessionStorageReducer<S, A>(
  reducer: Reducer<S, A>,
  createInitialState: () => S,
  storageName: string,
) {
  const scope = useAccountScope();
  const key = scope ? storageKey(scope.userId, storageName) : '';
  const initializerRef = useRef(createInitialState);

  const initializer = useCallback((): S => {
    const baseState = initializerRef.current();
    const persisted = readFromSessionStorage<Partial<S>>(key);
    if (persisted && compatible(persisted, baseState) && validWorkflow(key, persisted)) {
      return { ...baseState, ...persisted };
    }
    return baseState;
  }, [key]);

  const [state, dispatch] = useReducer(reducer, undefined as unknown as S, initializer);

  useEffect(() => {
    if (scope?.active()) writeToSessionStorage(key, state);
  }, [key, state, scope]);

  const guardedDispatch = useCallback(
    (action: A) => {
      if (!scope || scope.active()) dispatch(action);
    },
    [scope],
  );
  return [state, guardedDispatch] as const;
}
