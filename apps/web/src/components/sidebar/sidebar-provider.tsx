'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const COLLAPSED_KEY = 'metu:sidebar:collapsed';

interface Ctx {
  collapsed: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (v: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}

const SidebarContext = createContext<Ctx | null>(null);

export function useSidebar() {
  const c = useContext(SidebarContext);
  if (!c) throw new Error('useSidebar must be used inside <SidebarProvider>');
  return c;
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(COLLAPSED_KEY);
      if (v === '1') setCollapsedState(true);
    } catch {
      /* ignore */
    }
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    try {
      localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  const value = useMemo(
    () => ({ collapsed, toggleCollapsed, setCollapsed, mobileOpen, setMobileOpen }),
    [collapsed, toggleCollapsed, setCollapsed, mobileOpen],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
