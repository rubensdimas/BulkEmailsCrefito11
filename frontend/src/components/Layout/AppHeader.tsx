import { NavLink } from 'react-router-dom';
import { AccountMenu } from '../Auth/AccountMenu';
import { useAuth } from '../Auth/AuthProvider';
export function AppHeader() {
  const { isAdmin } = useAuth();
  const linkClass = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-50'}`;
  return <header className="bg-white shadow-sm"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
    <nav aria-label="Principal" className="flex flex-wrap items-center gap-2">
      <NavLink to="/" end className={linkClass}>Novo Envio</NavLink>
      <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
      {isAdmin && <NavLink to="/settings" className={linkClass}>Configurações</NavLink>}
    </nav><AccountMenu />
  </div></header>;
}
