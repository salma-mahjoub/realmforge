import { useCallback, useEffect, useState } from 'react';

/** Tiny async-data hook with reload. Keeps the previous data while refetching (no layout jump). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
    const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
    const [nonce, setNonce] = useState(0);
    useEffect(() => {
        let alive = true;
        setState((s) => ({ ...s, loading: true, error: undefined }));
        fn()
            .then((data) => alive && setState({ data, loading: false }))
            .catch((error: Error) => alive && setState((s) => ({ data: s.data, error, loading: false })));
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, nonce]);
    const reload = useCallback(() => setNonce((n) => n + 1), []);
    return { ...state, reload };
}
