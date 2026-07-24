import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

// Secondary routes are lazy so they don't weigh down the initial load
const AdminPage = lazy(() =>
  import('./components/admin/AdminPage.tsx').then((m) => ({ default: m.AdminPage })),
);
const CharacterConfigEditor = lazy(() =>
  import('./components/admin/CharacterConfigEditor.tsx').then((m) => ({
    default: m.CharacterConfigEditor,
  })),
);
const SwissTestPage = lazy(() =>
  import('./components/tournament/SwissTestPage.tsx').then((m) => ({
    default: m.SwissTestPage,
  })),
);

function RouteFallback() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <p className="text-slate-400">Loading…</p>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/characters" element={<CharacterConfigEditor />} />
        <Route path="/swiss-test" element={<SwissTestPage />} />
        <Route path="*" element={<App />} />
      </Routes>
    </Suspense>
  </BrowserRouter>
);
