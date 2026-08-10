import { useState } from 'react';
import { useAuth } from './AuthProvider';

export function AccountMenu() {
  const { enabled, user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  if (!enabled || !user) return null;

  const handleLogout = async (): Promise<void> => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span className="hidden sm:block text-sm text-gray-600" title={user.email}>{user.name || user.email || user.sub}</span>
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={isLoggingOut}
        className="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-60"
      >
        Sair
      </button>
    </div>
  );
}
