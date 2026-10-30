import { useEffect, useState } from 'react';

/** Tiny async-data hook (keeps pages free of boilerplate; swap for react-query queries later). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
    const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
    useEffect(() => {
        let alive = true;
        setState((s) => ({ ...s, loading: true }));
        fn()
            .then((data) => alive && setState({ data, loading: false }))
            .catch((error: Error) => alive && setState({ error, loading: false }));
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return state;
}
