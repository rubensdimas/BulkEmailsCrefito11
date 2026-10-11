import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthProvider';
export function AdminRoute() {
  return useAuth().isAdmin ? <Outlet /> : <Navigate to="/" replace />;
}
