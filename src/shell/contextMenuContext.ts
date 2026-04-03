import { createContext, useContext } from 'react';

export interface CtxMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

export type CtxMenuState = {
  x: number;
  y: number;
  items: CtxMenuItem[];
  header?: string;
} | null;

export interface CtxMenuContextType {
  show: (x: number, y: number, items: CtxMenuItem[], header?: string) => void;
  close: () => void;
}

export const CtxMenuContext = createContext<CtxMenuContextType>({
  show: () => {},
  close: () => {},
});

export function useContextMenu() {
  return useContext(CtxMenuContext);
}
