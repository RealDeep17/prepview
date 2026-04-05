import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from './store/appStore';
import type { BootstrapState } from './lib/types';
import { WorkstationShell } from './shell/WorkstationShell';
import { ContextMenuProvider } from './shell/ContextMenu';
import { ToastProvider } from './shell/Toast';

export default function App() {
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const applyBootstrap = useAppStore((s) => s.applyBootstrap);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);
  const closeOverlay = useAppStore((s) => s.closeOverlay);

  useEffect(() => {
    fetchBootstrap();
    const unlisten = listen<BootstrapState>('prepview://state-changed', (event) => {
      applyBootstrap(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [applyBootstrap, fetchBootstrap]);

  // Global Escape key to close overlays
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOverlay();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeOverlay]);

  if (loading) {
    return <div className="loading-screen">Loading PrepView…</div>;
  }

  if (error) {
    return (
      <div className="error-screen">
        <div>Failed to load</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{error}</div>
        <button className="btn btn--primary" onClick={fetchBootstrap}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <ToastProvider>
      <ContextMenuProvider>
        <WorkstationShell />
      </ContextMenuProvider>
    </ToastProvider>
  );
}
