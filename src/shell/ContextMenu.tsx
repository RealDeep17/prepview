import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';

export interface CtxMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

type CtxMenuState = {
  x: number;
  y: number;
  items: CtxMenuItem[];
  header?: string;
} | null;

interface CtxMenuContextType {
  show: (x: number, y: number, items: CtxMenuItem[], header?: string) => void;
  close: () => void;
}

const CtxMenuContext = createContext<CtxMenuContextType>({
  show: () => {},
  close: () => {},
});

export function useContextMenu() {
  return useContext(CtxMenuContext);
}

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<CtxMenuState>(null);
  const ref = useRef<HTMLDivElement>(null);

  const show = useCallback((x: number, y: number, items: CtxMenuItem[], header?: string) => {
    // Clamp position to viewport
    const maxX = window.innerWidth - 200;
    const maxY = window.innerHeight - (items.length * 36 + 40);
    setMenu({ x: Math.min(x, maxX), y: Math.min(y, maxY), items, header });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  // Close on click outside or Escape
  useEffect(() => {
    if (!menu) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menu, close]);

  // Block default browser context menu globally
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  return (
    <CtxMenuContext.Provider value={{ show, close }}>
      {children}
      {menu && (
        <div ref={ref} className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          {menu.header && <div className="ctx-label">{menu.header}</div>}
          {menu.items.map((item, i) => (
            <div
              key={i}
              className={`ctx-item${item.danger ? ' ctx-item--danger' : ''}`}
              onClick={() => { item.action(); close(); }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </CtxMenuContext.Provider>
  );
}
