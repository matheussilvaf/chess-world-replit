import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx';
import { AdminPage } from './components/admin/AdminPage.tsx';
import { CharacterConfigEditor } from './components/admin/CharacterConfigEditor.tsx';
import { SwissTestPage } from './components/tournament/SwissTestPage.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/characters" element={<CharacterConfigEditor />} />
      <Route path="/swiss-test" element={<SwissTestPage />} />
      <Route path="*" element={<App />} />
    </Routes>
  </BrowserRouter>
);
