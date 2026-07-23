import { useState, useEffect, useCallback } from 'react';
import { tournamentApi } from './api';
import { getColyseusHttpUrl, isColyseusConfigured } from '../../config/colyseus';
import { ConfigSection } from './sections/ConfigSection';
import { PlayersSection } from './sections/PlayersSection';
import { RoundSection } from './sections/RoundSection';
import { StandingsSection } from './sections/StandingsSection';
import { DiagnosticsSection } from './sections/DiagnosticsSection';
import { PlayerSummary } from './sections/PlayerSummary';
import { Trophy, RefreshCw, Plus, Trash2, Download, Upload, Wifi, WifiOff, Database, Cpu, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface HealthStatus {
  server: boolean;
  tournamentService: boolean;
  database: boolean;
  databaseError: string | null;
  pairingEngine: boolean;
  engineVersion: string | null;
  engineError: string | null;
  checkerAvailable: boolean;
  platform: string | null;
  arch: string | null;
}

function StatusBadge({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string | null }) {
  if (ok === null) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">
        <AlertTriangle className="w-3 h-3" /> {label}: Checking...
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border ${
      ok ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/50' : 'bg-red-900/30 text-red-300 border-red-700/50'
    }`} title={detail || undefined}>
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {label}: {ok ? 'Available' : 'Unavailable'}
      {detail && <span className="opacity-60">({detail})</span>}
    </span>
  );
}

function DiagBox({ label, value, ok }: { label: string; value: any; ok?: boolean }) {
  return (
    <div className="bg-black/30 rounded p-1.5">
      <p className="text-slate-500 text-[9px] uppercase">{label}</p>
      <p className={`font-bold ${ok === true ? 'text-emerald-400' : ok === false ? 'text-red-400' : 'text-slate-300'}`}>{value ?? '-'}</p>
    </div>
  );
}

export function SwissTestPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [tournament, setTournament] = useState<any>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [engineDiag, setEngineDiag] = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const connected = true;

  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.height = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    const root = document.getElementById('root');
    if (root) { root.style.overflow = 'auto'; root.style.height = 'auto'; }
    return () => {
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
      document.body.style.overflow = '';
      document.body.style.height = '';
      if (root) { root.style.overflow = ''; root.style.height = ''; }
    };
  }, []);

  const checkHealth = useCallback(async () => {
    if (!isColyseusConfigured()) {
      setHealthError('VITE_COLYSEUS_URL not configured');
      return;
    }
    try {
      const status = await tournamentApi.getHealthStatus();
      setHealth(status);
      setHealthError(null);
    } catch (e: any) {
      setHealthError(e.message || 'Cannot reach server');
      setHealth(null);
    }
  }, []);

  const loadTournaments = useCallback(async () => {
    try {
      const list = await tournamentApi.listTournaments();
      setTournaments(list);
    } catch { /* silent - health will show the issue */ }
  }, []);

  const fetchEngineDiag = useCallback(async () => {
    setDiagLoading(true);
    try {
      const diag = await tournamentApi.getEngineDiagnostics();
      setEngineDiag(diag);
    } catch (e: any) {
      setEngineDiag({ error: e.message || 'Cannot reach server' });
    } finally {
      setDiagLoading(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    loadTournaments();
    tournamentApi.listPresets().then(setPresets).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (selectedId) {
      try {
        const t = await tournamentApi.getTournament(selectedId);
        setTournament(t);
      } catch (e: any) {
        setError(e.message);
      }
    }
  }, [selectedId]);

  const createNew = async () => {
    try {
      setError(null);
      const t = await tournamentApi.createTournament('Swiss Test');
      setSelectedId(t.id);
      setDiagnostics(null);
      await loadTournaments();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteTournament = async () => {
    if (!selectedId) return;
    if (!confirm('Delete this tournament?')) return;
    try {
      await tournamentApi.deleteTournament(selectedId);
      setSelectedId(null);
      setDiagnostics(null);
      await loadTournaments();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const exportTournament = () => {
    if (!tournament) return;
    const blob = new Blob([JSON.stringify(tournament, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tournament-${tournament.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importTournament = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const t = await tournamentApi.importTournament(data);
        setSelectedId(t.id);
        await loadTournaments();
      } catch (err: any) {
        setError(err.message);
      }
    };
    input.click();
  };

  const handleAction = async (fn: () => Promise<any>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      if (result?.tournament) {
        // Room will auto-sync, but also update tournaments list
      }
      if (result?.diagnostics) setDiagnostics(result.diagnostics);
      refresh();
      await loadTournaments();
    } catch (e: any) {
      setError(e.message);
      try {
        const parsed = JSON.parse(e.message.replace(/^.*?{/, '{'));
        if (parsed.diagnostics) setDiagnostics(parsed.diagnostics);
      } catch { /* not json */ }
    } finally {
      setLoading(false);
    }
  };

  const endpoint = isColyseusConfigured() ? getColyseusHttpUrl() : 'Not configured';

  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#e2e8f0' }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-700/50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trophy className="w-6 h-6 text-amber-400" />
            <h1 className="text-lg font-bold text-white">Swiss Tournament Test</h1>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              FIDE Dutch System
            </span>
            {connected ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                <Wifi className="w-3 h-3" /> Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <WifiOff className="w-3 h-3" /> Disconnected
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={createNew} className="btn-sm btn-primary" title="New tournament" disabled={!health?.tournamentService}>
              <Plus className="w-4 h-4" />
            </button>
            <button onClick={refresh} className="btn-sm btn-ghost" title="Refresh" disabled={!tournament}>
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={exportTournament} className="btn-sm btn-ghost" title="Export" disabled={!tournament}>
              <Download className="w-4 h-4" />
            </button>
            <button onClick={importTournament} className="btn-sm btn-ghost" title="Import">
              <Upload className="w-4 h-4" />
            </button>
            <button onClick={deleteTournament} className="btn-sm btn-danger" title="Delete" disabled={!tournament}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Health status bar */}
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-slate-900/80 border border-slate-700/50">
          <span className="text-xs text-slate-500 mr-2">Server Status:</span>
          {healthError ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-red-900/30 text-red-300 border border-red-700/50">
              <XCircle className="w-3 h-3" /> {healthError}
            </span>
          ) : (
            <>
              <StatusBadge ok={health?.server ?? null} label="Colyseus Cloud" />
              <StatusBadge ok={health?.tournamentService ?? null} label="Tournament" />
              <StatusBadge ok={health?.database ?? null} label="Database" detail={health?.databaseError} />
              <StatusBadge ok={health?.pairingEngine ?? null} label="Pairing Engine" detail={health?.engineError} />
              {health?.engineVersion && (
                <span className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  bbpPairings {health.engineVersion}
                </span>
              )}
              <StatusBadge ok={health?.checkerAvailable ?? null} label="Checker" />
              {health?.platform && (
                <span className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-500 border border-slate-700">
                  {health.platform}/{health.arch}
                </span>
              )}
            </>
          )}
          <span className="ml-auto text-[10px] text-slate-600 font-mono">{endpoint}</span>
        </div>

        {/* Engine Diagnostics Panel */}
        <div className="mb-4">
          <button
            onClick={fetchEngineDiag}
            disabled={diagLoading}
            className="text-xs px-3 py-1.5 rounded bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700 hover:text-slate-300 transition-colors disabled:opacity-50"
          >
            {diagLoading ? 'Loading...' : 'Run Engine Diagnostics'}
          </button>
          {engineDiag && (
            <div className="mt-2 bg-slate-900 border border-slate-700 rounded-lg p-4 text-xs font-mono space-y-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                <DiagBox label="Platform" value={engineDiag.platform} />
                <DiagBox label="Arch" value={engineDiag.arch} />
                <DiagBox label="File Exists" value={engineDiag.fileExists ? 'Yes' : 'No'} ok={engineDiag.fileExists} />
                <DiagBox label="Executable" value={engineDiag.executableBit ? 'Yes' : 'No'} ok={engineDiag.executableBit} />
                <DiagBox label="File Size" value={engineDiag.fileSize ? `${(engineDiag.fileSize / 1024 / 1024).toFixed(1)} MB` : '-'} />
                <DiagBox label="Permissions" value={engineDiag.filePermissions || '-'} />
                <DiagBox label="Exit Code" value={engineDiag.exitCode ?? '-'} />
                <DiagBox label="Duration" value={`${engineDiag.durationMs}ms`} />
              </div>
              <div>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                  engineDiag.diagnosis === 'OK' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-red-900/50 text-red-300'
                }`}>
                  {engineDiag.diagnosis || 'Unknown'}
                </span>
                {engineDiag.spawnErrorCode && (
                  <span className="ml-2 text-red-400">Code: {engineDiag.spawnErrorCode}</span>
                )}
                {engineDiag.signal && (
                  <span className="ml-2 text-amber-400">Signal: {engineDiag.signal}</span>
                )}
              </div>
              {engineDiag.stdout && (
                <div>
                  <p className="text-slate-500 mb-0.5">stdout:</p>
                  <pre className="bg-black/50 rounded p-2 text-slate-400 overflow-x-auto whitespace-pre-wrap">{engineDiag.stdout}</pre>
                </div>
              )}
              {engineDiag.stderr && (
                <div>
                  <p className="text-slate-500 mb-0.5">stderr:</p>
                  <pre className="bg-black/50 rounded p-2 text-red-400 overflow-x-auto whitespace-pre-wrap">{engineDiag.stderr}</pre>
                </div>
              )}
              {engineDiag.fixture && (
                <div className="border-t border-slate-700 pt-2 mt-2">
                  <p className="text-slate-400 font-semibold mb-1">Fixture Test</p>
                  <div className="flex gap-3">
                    <span className={engineDiag.fixture.dutchOk ? 'text-emerald-400' : 'text-red-400'}>
                      Dutch: {engineDiag.fixture.dutchOk ? 'OK' : `FAIL${engineDiag.fixture.dutchError ? ` - ${engineDiag.fixture.dutchError}` : ''}`}
                    </span>
                    <span className={engineDiag.fixture.checkerOk ? 'text-emerald-400' : 'text-red-400'}>
                      Checker: {engineDiag.fixture.checkerOk ? 'OK' : `FAIL${engineDiag.fixture.checkerError ? ` - ${engineDiag.fixture.checkerError}` : ''}`}
                    </span>
                    <span className="text-slate-500">{engineDiag.fixture.durationMs}ms</span>
                  </div>
                </div>
              )}
              {engineDiag.error && (
                <p className="text-red-400">{engineDiag.error}</p>
              )}
            </div>
          )}
        </div>

        {/* Tournament selector */}
        {tournaments.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-400">Tournaments:</span>
            {tournaments.map(t => (
              <button
                key={t.id}
                onClick={() => { setSelectedId(t.id); setDiagnostics(null); setError(null); }}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  selectedId === t.id
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {t.name} ({t.status})
              </button>
            ))}
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {!tournament ? (
          <div className="text-center py-20">
            <Trophy className="w-16 h-16 mx-auto mb-4 text-slate-600" />
            <p className="text-lg text-slate-400">Create or select a tournament to begin</p>
            <button onClick={createNew} className="mt-4 btn-sm btn-primary inline-flex" disabled={!health?.tournamentService}>
              <Plus className="w-4 h-4" /> Create Tournament
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ConfigSection
                tournament={tournament}
                engineStatus={health ? { available: health.pairingEngine, version: health.engineVersion, error: health.engineError } : null}
                onAction={handleAction}
              />
              <PlayersSection
                tournament={tournament}
                presets={presets}
                onAction={handleAction}
                onRefresh={refresh}
              />
            </div>

            {tournament.rounds?.length > 0 && (
              <RoundSection
                tournament={tournament}
                onAction={handleAction}
                onRefresh={refresh}
              />
            )}

            {tournament.standings?.length > 0 && (
              <StandingsSection tournament={tournament} />
            )}

            {diagnostics && (
              <DiagnosticsSection diagnostics={diagnostics} />
            )}

            {tournament.status === 'finished' && (
              <PlayerSummary tournament={tournament} />
            )}
          </div>
        )}
      </main>

      {/* Loading overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 flex items-center gap-3">
            <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
            <span className="text-slate-200">Processing...</span>
          </div>
        </div>
      )}
    </div>
  );
}
