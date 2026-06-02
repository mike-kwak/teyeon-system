'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface LoadingCtx {
    isLoading: boolean;
    showLoading: () => void;
    hideLoading: () => void;
}

const LoadingContext = createContext<LoadingCtx>({
    isLoading: false,
    showLoading: () => {},
    hideLoading: () => {},
});

export function LoadingProvider({ children }: { children: ReactNode }) {
    const [isLoading, setIsLoading] = useState(false);
    const showLoading = useCallback(() => setIsLoading(true), []);
    const hideLoading = useCallback(() => setIsLoading(false), []);
    return (
        <LoadingContext.Provider value={{ isLoading, showLoading, hideLoading }}>
            {children}
        </LoadingContext.Provider>
    );
}

export function useLoading() {
    return useContext(LoadingContext);
}
