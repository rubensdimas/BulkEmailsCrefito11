// Frontend App component with React Router
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import StatusPage from './pages/StatusPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/status/:jobId" element={<StatusPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;