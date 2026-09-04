import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

// Secondary routes are lazy so they don't weigh down the initial load
const AdminPage = lazy(() =>
  import('./components/admin/AdminPage.tsx').then((m) => ({ default: m.AdminPage })),
);
const RigControllerPage = lazy(() =>
  import('./components/admin/rig-editor/index.tsx').then((m) => ({
    default: m.RigControllerPage,
  })),
);
const SwissTestPage = lazy(() =>
  import('./components/tournament/SwissTestPage.tsx').then((m) => ({
    default: m.SwissTestPage,
  })),
);
const CharacterGeneratorPage = lazy(() =>
  import('./components/admin/character-generator/CharacterGeneratorPage.tsx').then((m) => ({
    default: m.CharacterGeneratorPage,
  })),
);
const CraftAdminPage = lazy(() =>
  import('./components/admin/craft/CraftAdminPage.tsx').then((m) => ({
    default: m.CraftAdminPage,
  })),
);
const CollectionAdminPage = lazy(() =>
  import('./components/admin/collection/CollectionAdminPage.tsx').then((m) => ({
    default: m.CollectionAdminPage,
  })),
);
const StationsControllerPage = lazy(() =>
  import('./components/admin/stations/StationsControllerPage.tsx').then((m) => ({
    default: m.StationsControllerPage,
  })),
);
const AssetsControllerPage = lazy(() =>
  import('./components/admin/assets/AssetsControllerPage.tsx').then((m) => ({
    default: m.AssetsControllerPage,
  })),
);

// Bancadas DEV (inventário: DnD/durabilidade; controles: configurações e
// teclas) sem Phaser. Fora do DEV o `import.meta.env.DEV` é substituído
// estaticamente e os chunks nem são gerados.
const InventoryBenchPage = import.meta.env.DEV
  ? lazy(() =>
      import('./components/dev/InventoryBenchPage.tsx').then((m) => ({
        default: m.InventoryBenchPage,
      })),
    )
  : null;
const ControlsBenchPage = import.meta.env.DEV
  ? lazy(() =>
      import('./components/dev/ControlsBenchPage.tsx').then((m) => ({
        default: m.ControlsBenchPage,
      })),
    )
  : null;

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
        <Route path="/admin/rigs" element={<RigControllerPage />} />
        <Route path="/admin/craft" element={<CraftAdminPage />} />
        <Route path="/admin/stations" element={<StationsControllerPage />} />
        <Route path="/admin/mundo-coleta" element={<CollectionAdminPage />} />
        <Route path="/admin/assets-controller" element={<AssetsControllerPage />} />
        {/* Old editor URL — kept as a permanent redirect (spec §3) */}
        <Route path="/admin/characters" element={<Navigate to="/admin/rigs" replace />} />
        <Route path="/admin/character-generator" element={<CharacterGeneratorPage />} />
        <Route path="/swiss-test" element={<SwissTestPage />} />
        {InventoryBenchPage && <Route path="/dev/inventario" element={<InventoryBenchPage />} />}
        {ControlsBenchPage && <Route path="/dev/controles" element={<ControlsBenchPage />} />}
        <Route path="*" element={<App />} />
      </Routes>
    </Suspense>
  </BrowserRouter>
);
