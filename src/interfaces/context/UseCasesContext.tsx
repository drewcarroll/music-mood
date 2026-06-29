import React, { createContext, useContext, useMemo } from 'react';
import { AppUseCases } from '@application/AppUseCases';
import { MusicSessionController } from '@interfaces/controllers/MusicSessionController';

interface UseCasesContextValue {
  controller: MusicSessionController;
}

const UseCasesContext = createContext<UseCasesContextValue | null>(null);

interface ProviderProps {
  useCases: AppUseCases;
  children: React.ReactNode;
}

/**
 * Provides a thin controller (built from injected use cases) to the React tree.
 * Use cases are injected by the bootstrap layer; the interfaces layer never
 * constructs infrastructure itself.
 */
export function UseCasesProvider({ useCases, children }: ProviderProps): React.JSX.Element {
  const value = useMemo<UseCasesContextValue>(
    () => ({ controller: new MusicSessionController(useCases) }),
    [useCases],
  );
  return <UseCasesContext.Provider value={value}>{children}</UseCasesContext.Provider>;
}

export function useMusicSessionController(): MusicSessionController {
  const ctx = useContext(UseCasesContext);
  if (!ctx) {
    throw new Error('useMusicSessionController must be used within a <UseCasesProvider>.');
  }
  return ctx.controller;
}
