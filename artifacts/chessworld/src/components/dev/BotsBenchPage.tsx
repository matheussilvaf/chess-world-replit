import { useEffect, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { getColyseusHttpUrl } from '../../config/colyseus';
import { DEFAULT_ACADEMY_BOTS, mergeAcademyBots, type AcademyBot, type AcademyBotsResponse } from '../../shared/academy/AcademyShapes';
import { botEngine } from '../../game/bots/botEngine';
import type { BotMoveResult, EngineStatus } from '../../game/bots/StockfishBot';
import { LevelBars } from '../academy/LevelBars';
import { SimpleChessBoard } from '../chess/SimpleChessBoard';

const times = [
  { label: 'Sem relógio', seconds: 0, increment: 0 },
  { label: '3+2', seconds: 180, increment: 2 },
  { label: '5+0', seconds: 300, increment: 0 },
  { label: '10+0', seconds: 600, increment: 0 },
];

type Game = {
  bot: AcademyBot;
  human: 'w' | 'b';
  chess: Chess;
  result: string | null;
  lastMove?: { from: string; to: string };
  time: number;
  clocks: { w: number; b: number };
};

function outcome(chess: Chess): string | null {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? 'Xeque-mate — pretas venceram' : 'Xeque-mate — brancas venceram';
  if (chess.isStalemate()) return 'Empate por afogamento';
  if (chess.isThreefoldRepetition()) return 'Empate por repetição';
  if (chess.isInsufficientMaterial()) return 'Empate por material insuficiente';
  if (chess.isDraw()) return 'Empate';
  return null;
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

export default function BotsBenchPage() {
  const [bots, setBots] = useState<AcademyBot[]>(DEFAULT_ACADEMY_BOTS);
  const [color, setColor] = useState<'w' | 'b' | 'random'>('w');
  const [time, setTime] = useState(0);
  const [game, setGame] = useState<Game | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>(botEngine.status());
  const [engineDetail, setEngineDetail] = useState('');
  const [thinking, setThinking] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ move: BotMoveResult; ms: number } | null>(null);

  useEffect(() => {
    const unsubscribe = botEngine.subscribe((status, detail) => { setEngineStatus(status); setEngineDetail(detail ?? ''); });
    botEngine.acquire().catch((error) => setEngineDetail(error instanceof Error ? error.message : String(error)));
    return () => { unsubscribe(); botEngine.shutdown(); };
  }, []);

  useEffect(() => {
    const http = getColyseusHttpUrl();
    if (!http) return;
    const controller = new AbortController();
    fetch(`${http.replace(/\/api$/, '')}/api/academy/bots`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error('Configuração indisponível'); return response.json() as Promise<AcademyBotsResponse>; })
      .then((data) => { if (Array.isArray(data.bots)) setBots(mergeAcademyBots(data.bots)); })
      .catch(() => { /* A bancada funciona offline com os quatro bots padrão. */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!game || game.result || !game.time) return;
    const interval = window.setInterval(() => setGame((previous) => {
      if (!previous || previous.result || !previous.time) return previous;
      const side = previous.chess.turn();
      const remaining = Math.max(0, previous.clocks[side] - 0.1);
      return { ...previous, clocks: { ...previous.clocks, [side]: remaining },
        result: remaining === 0 ? `Tempo esgotado — ${side === 'w' ? 'pretas' : 'brancas'} venceram` : null };
    }), 100);
    return () => clearInterval(interval);
  }, [game?.bot.id, game?.result, game?.time]);

  const fen = game?.chess.fen();
  useEffect(() => {
    if (!game || game.result || game.chess.turn() === game.human || engineStatus !== 'ready') return;
    const controller = new AbortController();
    const started = performance.now();
    setThinking(true);
    botEngine.acquire().then(async (engine) => {
      try {
        const move = await engine.bestMove({ fen: game.chess.fen(), level: game.bot.level }, controller.signal);
        if (controller.signal.aborted) return;
        // Restore full game history so repetition and SAN history remain valid.
        const full = new Chess();
        for (const entry of game.chess.history()) full.move(entry);
        const played = full.move({ from: move.from, to: move.to, promotion: move.promotion });
        if (!played) throw new Error(`Lance do bot inválido: ${move.uci}`);
        setDiagnostics({ move, ms: Math.round(performance.now() - started) });
        setGame((previous) => previous?.chess.fen() === game.chess.fen() && !previous.result
          ? { ...previous, chess: full, lastMove: { from: move.from, to: move.to },
            clocks: { ...previous.clocks, [played.color]: previous.clocks[played.color] + times[previous.time].increment },
            result: outcome(full) } : previous);
      } catch (error) {
        if (!controller.signal.aborted) setEngineDetail(error instanceof Error ? error.message : String(error));
      } finally {
        setThinking(false);
        botEngine.release();
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setEngineDetail(error instanceof Error ? error.message : String(error));
      setThinking(false);
      botEngine.release();
    });
    return () => controller.abort();
  }, [fen, game?.bot.id, game?.result, game?.human, engineStatus]);

  function play(from: string, to: string, promotion?: string): boolean {
    if (!game || game.result || thinking || game.chess.turn() !== game.human) return false;
    const next = new Chess();
    for (const entry of game.chess.history()) next.move(entry);
    try {
      const played = next.move({ from, to, promotion: promotion ?? 'q' });
      if (!played) return false;
      setGame({ ...game, chess: next, lastMove: { from, to }, result: outcome(next),
        clocks: { ...game.clocks, [played.color]: game.clocks[played.color] + times[game.time].increment } });
      return true;
    } catch { return false; }
  }

  function start(bot: AcademyBot) {
    const human = color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color;
    setDiagnostics(null);
    setThinking(false);
    setGame({ bot, human, chess: new Chess(), result: null, time,
      clocks: { w: times[time].seconds, b: times[time].seconds } });
  }

  const history = game?.chess.history() ?? [];
  const checkSquare = game?.chess.isCheck()
    ? game.chess.board().flat().find((piece) => piece?.type === 'k' && piece.color === game.chess.turn())?.square ?? null : null;

  return <main className="min-h-screen bg-slate-950 text-slate-100 px-4 py-8">
    <div className="max-w-6xl mx-auto">
      <header className="mb-8"><h1 className="text-3xl font-bold text-amber-200">Bancada dos Bots — Tactics Academy</h1>
        <p className="text-slate-400 mt-2">Escolha um adversário e pratique xadrez.</p></header>
      <div className="mb-5 flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${engineStatus === 'ready' ? 'bg-emerald-900 text-emerald-300' : engineStatus === 'error' ? 'bg-red-900 text-red-200' : 'bg-slate-700 text-slate-200'}`}>
          Engine: {engineStatus === 'ready' ? 'pronto' : engineStatus === 'loading' ? 'carregando' : engineStatus === 'error' ? 'erro' : 'inativo'}
        </span>
        {engineDetail && <span role="alert" className="text-sm text-red-300">{engineDetail}</span>}
      </div>
      {!game ? <>
        <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl bg-slate-900 p-4">
          <label className="flex items-center gap-2">Sua cor
            <select aria-label="Sua cor" value={color} onChange={(e) => setColor(e.target.value as typeof color)} className="bg-slate-800 rounded p-2">
              <option value="w">Brancas</option><option value="random">Aleatório</option><option value="b">Pretas</option>
            </select>
          </label>
          <label className="flex items-center gap-2">Relógio
            <select aria-label="Relógio" value={time} onChange={(e) => setTime(Number(e.target.value))} className="bg-slate-800 rounded p-2">
              {times.map((option, index) => <option value={index} key={index}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{bots.map((bot) => <article key={bot.id} className="bg-slate-900 rounded-xl border border-slate-700 p-5 flex flex-col gap-4">
          <h2 className="text-xl font-semibold">{bot.name}</h2><LevelBars level={bot.level} />
          <button type="button" onClick={() => start(bot)} className="rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold px-4 py-2">Jogar</button>
        </article>)}</div>
      </> : <div className="grid lg:grid-cols-[minmax(0,560px)_1fr] gap-6">
        <SimpleChessBoard fen={game.chess.fen()} orientation={game.human} interactive={!game.result && !thinking && game.chess.turn() === game.human}
          onMove={play} chess={game.chess} lastMove={game.lastMove} checkSquare={checkSquare}
          legalMovesFor={(square) => game.chess.moves({ square: square as Square, verbose: true }).map((move) => move.to)} />
        <section className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-5">
          <div><h2 className="text-2xl font-semibold">{game.bot.name}</h2><LevelBars level={game.bot.level} /></div>
          <p aria-live="polite" className="text-lg font-semibold text-amber-200">{game.result ?? (game.chess.turn() === game.human ? 'Sua vez' : `${game.bot.name} pensando…`)}</p>
          {!!game.time && <div className="flex gap-6 text-lg tabular-nums"><span>Brancas: {clock(game.clocks.w)}</span><span>Pretas: {clock(game.clocks.b)}</span></div>}
          <div className="rounded-lg bg-slate-800 p-3 max-h-64 overflow-y-auto">
            <h3 className="font-semibold mb-2">Lances</h3>
            <div className="grid grid-cols-[3rem_1fr_1fr] gap-y-1 text-sm tabular-nums">{Array.from({ length: Math.ceil(history.length / 2) }, (_, index) => <div key={index} className="contents">
              <span className="text-slate-400">{index + 1}.</span><span>{history[index * 2]}</span><span>{history[index * 2 + 1] ?? ''}</span>
            </div>)}</div>
          </div>
          {diagnostics && <aside className="rounded-lg bg-slate-800 p-3 text-sm text-slate-300">
            <p>Diagnóstico: {diagnostics.ms} ms · lance {diagnostics.move.uci}</p>
            <p>Candidatos: {diagnostics.move.candidates.join(', ')}</p>
          </aside>}
          <div className="flex gap-3">
            <button type="button" disabled={!!game.result} onClick={() => setGame({ ...game, result: 'Partida encerrada por desistência' })}
              className="rounded-lg bg-red-900 hover:bg-red-800 disabled:opacity-50 px-4 py-2">Desistir</button>
            <button type="button" onClick={() => { setGame(null); setDiagnostics(null); }}
              className="rounded-lg bg-slate-700 hover:bg-slate-600 px-4 py-2">Nova partida</button>
          </div>
        </section>
      </div>}
    </div>
  </main>;
}