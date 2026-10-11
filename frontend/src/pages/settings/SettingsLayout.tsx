import { NavLink, Outlet } from 'react-router-dom';
import { AppHeader } from '../../components/Layout/AppHeader';

const sections = [
  { to: '/settings/users', label: 'Usuários' },
  { to: '/settings/email', label: 'E-mail' },
  { to: '/settings/oidc', label: 'Login intranet' },
];

const sideClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-700 hover:bg-gray-100'}`;
const tabClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${isActive ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`;

export default function SettingsLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-6">
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <nav aria-label="Configurações" data-settings-nav="tabs" className="mt-4 flex overflow-x-auto border-b border-gray-200 md:hidden">
          {sections.map((section) => <NavLink key={section.to} to={section.to} className={tabClass}>{section.label}</NavLink>)}
        </nav>
        <div className="mt-6 md:flex md:gap-8">
          <aside className="hidden w-52 shrink-0 md:block">
            <nav aria-label="Configurações" className="space-y-1">
              {sections.map((section) => <NavLink key={section.to} to={section.to} className={sideClass}>{section.label}</NavLink>)}
            </nav>
          </aside>
          <main className="min-w-0 flex-1"><Outlet /></main>
        </div>
      </div>
    </div>
  );
}
