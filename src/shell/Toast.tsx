import { useState, useCallback } from 'react';
import { ToastContext, type ToastMessage } from './toastContext';

let idCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const toast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
    const id = ++idCounter;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.type}`}>
              <span>{t.message}</span>
              <button
                className="toast-dismiss"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              >×</button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
