// Frontend App component with React Router
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import StatusPage from './pages/StatusPage';
import DashboardPage from './pages/DashboardPage';
import SettingsPage from './pages/SettingsPage';
import { AuthGate, AuthProvider } from './components/Auth/AuthProvider';

function App() {
  return <BrowserRouter><AuthProvider><AuthGate><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/dashboard" element={<DashboardPage />} />
    <Route path="/status/:jobId" element={<StatusPage />} />
    <Route path="/settings" element={<SettingsPage />} />
  </Routes></AuthGate></AuthProvider></BrowserRouter>;
}

export default App;
