import { useEffect, useState, useCallback } from 'react';
import { Trophy, Clock, Zap, Timer, Swords, CheckCircle2, AlertCircle } from 'lucide-react';
import { getColyseusHttpUrl } from '../../config/colyseus';
import { supabase } from '../../lib/supabase';

interface TournamentConfig {
  intervalSeconds: number;
  timeControl: {
    category: string;
    baseTimeSeconds: number;
    incrementSeconds: number;
    displayLabel: string;
  };
  swissConfig: {
    roundMode: string;
    initialColor: string;
    manualRoundCount: number | null;
    scoring: string;
    tiebreaks: string[];
  };
  randomize?: boolean;
  woTimeoutSeconds?: number;
}

interface EngineStatus {
  available: boolean;
  version: string;
  error?: string;
}

const INTERVAL_OPTIONS = [
  { value: 60, label: '1 minuto', note: 'teste' },
  { value: 3600, label: '1 hora' },
  { value: 7200, label: '2 horas' },
  { value: 10800, label: '3 horas' },
  { value: 14400, label: '4 horas' },
  { value: 21600, label: '6 horas' },
  { value: 28800, label: '8 horas' },
  { value: 36000, label: '10 horas' },
  { value: 54000, label: '15 horas' },
  { value: 86400, label: '24 horas' },
];

const TIME_CONTROL_OPTIONS = [
  { category: 'bullet', baseTimeSeconds: 60, incrementSeconds: 0, displayLabel: '1+0', group: 'Bullet' },
  { category: 'bullet', baseTimeSeconds: 60, incrementSeconds: 1, displayLabel: '1+1', group: 'Bullet' },
  { category: 'bullet', baseTimeSeconds: 120, incrementSeconds: 1, displayLabel: '2+1', group: 'Bullet' },
  { category: 'blitz', baseTimeSeconds: 180, incrementSeconds: 0, displayLabel: '3+0', group: 'Blitz' },
  { category: 'blitz', baseTimeSeconds: 180, incrementSeconds: 2, displayLabel: '3+2', group: 'Blitz' },
  { category: 'blitz', baseTimeSeconds: 300, incrementSeconds: 0, displayLabel: '5+0', group: 'Blitz' },
  { category: 'rapid', baseTimeSeconds: 600, incrementSeconds: 0, displayLabel: '10+0', group: 'Rapid' },
  { category: 'rapid', baseTimeSeconds: 600, incrementSeconds: 5, displayLabel: '10+5', group: 'Rapid' },
  { category: 'rapid', baseTimeSeconds: 900, incrementSeconds: 10, displayLabel: '15+10', group: 'Rapid' },
];

const ROUND_MODES = [
  { value: 'auto-normal', label: 'Auto Normal' },
  { value: 'auto-fast', label: 'Auto Fast' },
  { value: 'manual', label: 'Manual' },
];

const COLOR_OPTIONS = [
  { value: 'random', label: 'Random' },
  { value: 'w', label: 'White 1st' },
  { value: 'b', label: 'Black 1st' },
];

export function TournamentConfigSection({ serverUrl }: { serverUrl: string }) {
  const [config, setConfig] = useState<TournamentConfig | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coordinator REST endpoints are mounted under /api on the server. In
  // local-proxy mode the base URL ALREADY ends with /api; in cloud mode it
  // usually doesn't. Normalise so we never produce /api/api/... (404 — this
  // was silently hiding the whole section).
  const rawBase = (serverUrl || getColyseusHttpUrl()).replace(/\/+$/, '');
  const apiBase = rawBase.endsWith('/api') ? rawBase : `${rawBase}/api`;

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/coordinator/config`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConfig(data.config);
      setEngineStatus(data.engineStatus);
    } catch (err: any) {
      setError('Falha ao carregar configuração do torneio');
    }
  }, [apiBase]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const saveConfig = useCallback(async (newConfig: TournamentConfig) => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) { setError('Not authenticated'); setSaving(false); return; }

      const res = await fetch(`${apiBase}/coordinator/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(newConfig),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Save failed');
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }, [apiBase]);

  // Never disappear silently: while loading (or after a fetch failure) the
  // section stays visible with a status message + retry.
  if (!config) {
    return (
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base font-medium text-white">Tournament Configuration</h2>
            <p className="text-sm text-slate-400">Swiss tournament settings for the arena</p>
          </div>
        </div>
        {error ? (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-between gap-3">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => { setError(null); fetchConfig(); }}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 shrink-0"
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Carregando configuração...</p>
        )}
      </div>
    );
  }

  const selectedTimeKey = `${config.timeControl.baseTimeSeconds}-${config.timeControl.incrementSeconds}`;

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
          <Trophy className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-base font-medium text-white">Tournament Configuration</h2>
          <p className="text-sm text-slate-400">Swiss tournament settings for the arena</p>
        </div>
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-4 mb-6 p-3 rounded-lg bg-slate-800/50">
        <div className="flex items-center gap-2">
          {engineStatus?.available ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400" />
          )}
          <span className="text-xs text-slate-300">
            bbpPairings {engineStatus?.version || 'N/A'}
          </span>
        </div>
        <span className="text-xs text-slate-500">FIDE Dutch System</span>
      </div>

      {saved && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <p className="text-sm text-emerald-400">Configuration saved</p>
        </div>
      )}
      {error && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Randomize toggle */}
      <div className="flex items-center justify-between p-4 mb-5 rounded-lg bg-slate-800/60 border border-slate-700">
        <div>
          <p className="text-sm font-medium text-white flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            Randomize
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Cada torneio sorteia controle de tempo, intervalo e formato suíço automaticamente
          </p>
        </div>
        <button
          onClick={() => {
            const updated = { ...config, randomize: !config.randomize };
            setConfig(updated);
            saveConfig(updated);
          }}
          className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${
            config.randomize ? 'bg-amber-500' : 'bg-slate-700'
          }`}
          aria-label="Randomize tournaments"
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
              config.randomize ? 'translate-x-6' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <div className={`space-y-5 ${config.randomize ? 'opacity-50 pointer-events-none' : ''}`}>
        {/* Interval */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
            <Timer className="w-3.5 h-3.5 text-slate-400" />
            Intervalo entre torneios
          </label>
          <select
            value={config.intervalSeconds}
            onChange={(e) => {
              const updated = { ...config, intervalSeconds: Number(e.target.value) };
              setConfig(updated);
              saveConfig(updated);
            }}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
          >
            {!INTERVAL_OPTIONS.some(o => o.value === config.intervalSeconds) && (
              <option value={config.intervalSeconds}>
                {config.intervalSeconds}s — valor atual
              </option>
            )}
            {INTERVAL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}{opt.note ? ` — ${opt.note}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Time Control */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            Controle de tempo
          </label>
          <select
            value={selectedTimeKey}
            onChange={(e) => {
              const [base, inc] = e.target.value.split('-').map(Number);
              const option = TIME_CONTROL_OPTIONS.find(o => o.baseTimeSeconds === base && o.incrementSeconds === inc);
              if (option) {
                const updated = {
                  ...config,
                  timeControl: { category: option.category, baseTimeSeconds: option.baseTimeSeconds, incrementSeconds: option.incrementSeconds, displayLabel: option.displayLabel },
                };
                setConfig(updated);
                saveConfig(updated);
              }
            }}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
          >
            {(['Bullet', 'Blitz', 'Rapid'] as const).map(group => (
              <optgroup key={group} label={group}>
                {TIME_CONTROL_OPTIONS.filter(o => o.group === group).map(opt => (
                  <option key={opt.displayLabel} value={`${opt.baseTimeSeconds}-${opt.incrementSeconds}`}>
                    {opt.displayLabel}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
            <Zap className="w-3 h-3" />
            {config.timeControl.category.charAt(0).toUpperCase() + config.timeControl.category.slice(1)} — {config.timeControl.displayLabel}
          </div>
        </div>

        {/* Swiss Config */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
              <Swords className="w-3.5 h-3.5 text-slate-400" />
              Modo de rodadas
            </label>
            <select
              value={config.swissConfig.roundMode}
              onChange={(e) => {
                const updated = { ...config, swissConfig: { ...config.swissConfig, roundMode: e.target.value } };
                setConfig(updated);
                saveConfig(updated);
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              {ROUND_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-300 mb-2 block">
              Cor inicial
            </label>
            <select
              value={config.swissConfig.initialColor}
              onChange={(e) => {
                const updated = { ...config, swissConfig: { ...config.swissConfig, initialColor: e.target.value } };
                setConfig(updated);
                saveConfig(updated);
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              {COLOR_OPTIONS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        {config.swissConfig.roundMode === 'manual' && (
          <div>
            <label className="text-sm font-medium text-slate-300 mb-2 block">
              Quantidade de rodadas
            </label>
            <input
              type="number"
              min={1}
              max={30}
              value={config.swissConfig.manualRoundCount || ''}
              onChange={(e) => {
                const updated = { ...config, swissConfig: { ...config.swissConfig, manualRoundCount: Number(e.target.value) || null } };
                setConfig(updated);
                saveConfig(updated);
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
        )}

        {/* WO Timeout */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            Tempo de W.O. (segundos)
          </label>
          <input
            type="number"
            min={10}
            max={300}
            step={5}
            value={config.woTimeoutSeconds ?? 30}
            onChange={(e) => {
              const updated = { ...config, woTimeoutSeconds: Number(e.target.value) || 30 };
              setConfig(updated);
              saveConfig(updated);
            }}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
          />
          <p className="text-xs text-slate-500 mt-1">
            Tempo para o adversário chegar ao tabuleiro antes de W.O., e para reconexão após desconexão
          </p>
        </div>

        {/* Info display */}
        <div className="p-3 rounded-lg bg-slate-800/50 space-y-1.5">
          <p className="text-xs text-slate-400">
            <span className="text-slate-500">Scoring:</span>{' '}
            <span className="text-slate-300">Standard (1-0.5-0)</span>
          </p>
          <p className="text-xs text-slate-400">
            <span className="text-slate-500">PAB:</span>{' '}
            <span className="text-slate-300">1.0 pt (pairing-allocated bye)</span>
          </p>
          <p className="text-xs text-slate-400">
            <span className="text-slate-500">Tiebreaks:</span>{' '}
            <span className="text-slate-300">Buchholz Cut-1, Buchholz, Sonneborn-Berger, Progressive</span>
          </p>
        </div>
      </div>
    </div>
  );
}
