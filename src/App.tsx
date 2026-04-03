import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from './store/appStore';
import { WorkstationShell } from './shell/WorkstationShell';

export default function App() {
  const fetchBootstrap = useAppStore((s) => s.fetchBootstrap);
  const loading = useAppStore((s) => s.loading);
  const error = useAppStore((s) => s.error);

  useEffect(() => {
    fetchBootstrap();
    const unlisten = listen('cassini://state-changed', () => {
      fetchBootstrap();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchBootstrap]);

  if (loading) {
    return <div className="loading-screen">Loading Cassini…</div>;
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

  return <WorkstationShell />;
}
