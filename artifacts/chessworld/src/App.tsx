import { useEffect, lazy, Suspense } from 'react';
import { useAuthStore } from './stores/authStore';
import { useGameStore } from './stores/gameStore';
import { AuthPage } from './components/auth/AuthPage';
import { ServerSelect } from './components/game/ServerSelect';
import { Loader2 } from 'lucide-react';

// Lazy-load the game world: Phaser (~5.5MB), Colyseus, LiveKit and all game
// components only download after the player signs in and picks a region.
// This keeps the initial login screen fast.
const GameScene = lazy(() => import('./components/GameScene'));

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        <p className="text-slate-400">{message}</p>
      </div>
    </div>
  );
}

function App() {
  const { user, profile, loading, initialized, initialize } = useAuthStore();
  const { region } = useGameStore();

  useEffect(() => {
    initialize();
  }, []);

  if (!initialized || loading) {
    return <LoadingScreen message="Loading ChessWorld..." />;
  }

  if (!user || !profile) {
    return <AuthPage />;
  }

  if (!region) {
    return <ServerSelect />;
  }

  return (
    <Suspense fallback={<LoadingScreen message="Loading game world…" />}>
      <GameScene />
    </Suspense>
  );
}

export default App;
