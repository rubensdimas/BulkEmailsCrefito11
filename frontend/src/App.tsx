// Frontend App component with React Router
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import ChangePasswordPage from './pages/ChangePasswordPage';
import { AdminRoute } from './components/Auth/AdminRoute';
import HomePage from './pages/HomePage';
import StatusPage from './pages/StatusPage';
import DashboardPage from './pages/DashboardPage';
import SettingsLayout from './pages/settings/SettingsLayout';
import SettingsUsersPage from './pages/settings/SettingsUsersPage';
import SettingsEmailPage from './pages/settings/SettingsEmailPage';
import SettingsOidcPage from './pages/settings/SettingsOidcPage';
import LoginPage from './pages/LoginPage';
import { AuthGate, AuthProvider } from './components/Auth/AuthProvider';

function ProtectedRoutes() {
  return <AuthGate><Outlet /></AuthGate>;
}

function App() {
  return <BrowserRouter><AuthProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoutes />}>
      <Route path="/" element={<HomePage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/status/:jobId" element={<StatusPage />} />
      <Route path="/account/password" element={<ChangePasswordPage />} />
      <Route element={<AdminRoute />}>
        <Route path="/settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<SettingsUsersPage />} />
          <Route path="email" element={<SettingsEmailPage />} />
          <Route path="oidc" element={<SettingsOidcPage />} />
        </Route>
      </Route>
    </Route>
  </Routes></AuthProvider></BrowserRouter>;
}

export default App;
