/**
 * Card da peça do Big Chess Board (abre ao clicar numa peça no mapa):
 *   - peça PRÓPRIA: HP + regeneração, slots de capa (1) e defesa (2) com
 *     equipar a partir do inventário, renda acumulada + "Coletar renda",
 *     tempo dominando + pontos;
 *   - peça ADVERSÁRIA: dono, HP, defesas ativas, pontos/hora, renda e pontos
 *     totais, tempo dominando (ataque só com arma principal, no mapa).
 *
 * Renda/pontos são extrapolados a partir do último `syncedAt` do servidor.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Coins, Crown, Heart, Loader2, Shield, ShieldPlus, Swords, Timer, X } from 'lucide-react';
import { useBigChessStore } from '../../../stores/bigChessStore';
import { useAuthStore } from '../../../stores/authStore';
import { useCollectionInventoryStore } from '../../../stores/collectionInventoryStore';
import { getInventoryBridge } from '../../../game/inventory/inventoryBridge';
import { loadCraftBadges, useInventoryVisualCatalog } from '../../../lib/inventory/inventoryVisualCatalog';
import { loadBigChessConfig } from '../../../lib/bigchess/bigChessConfig';
import { InventoryItemName, InventoryItemThumb } from '../InventoryItemVisual';
import { itemHasBadge, type CraftBadgeMap } from '../../../shared/craft/CraftBadges';
import {
  BADGE_COVER,
  BADGE_DEFENSE_PIECE,
  BIGCHESS_DEFENSE_SLOTS,
  bigChessPieceFor,
  bigChessRulesFor,
  formatBigChessDuration,
  type BigChessConfig,
  type BigChessDefenseSlot,
  type BigChessPieceView,
} from '../../../shared/bigchess/BigChessShapes';

const REQUEST_TIMEOUT_MS = 8000;
const withBase = (url: string) => `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`;
const fmt = new Intl.NumberFormat('pt-BR');
const fmt1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function useNow(active: boolean, stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(timer);
  }, [active, stepMs]);
  return now;
}

/** Renda/pontos "ao vivo": o servidor republica a cada tick; entre eles o card extrapola. */
function liveNumbers(piece: BigChessPieceView, now: number) {
  const elapsedMs = Math.max(0, now - piece.syncedAt);
  const income = piece.incomeAccrued + (piece.incomePerDay * elapsedMs) / 86_400_000;
  const points = piece.points + (piece.pointsPerHour * elapsedMs) / 3_600_000;
  return { income, points };
}

export function BigChessOverlays() {
  const openSquare = useBigChessStore((s) => s.openSquare);
  const piece = useBigChessStore((s) => (openSquare ? s.pieces[openSquare] : undefined));
  const setOpenSquare = useBigChessStore((s) => s.setOpenSquare);
  const myId = useAuthStore((s) => s.user?.id ?? null);

  // Esc fecha o card.
  useEffect(() => {
    if (!openSquare) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenSquare(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSquare, setOpenSquare]);

  if (!openSquare || !piece) return null;
  const mine = !!myId && piece.ownerId === myId;
  return (
    <div className="pointer-events-none fixed inset-0 z-[512] grid place-items-center p-3">
      {mine ? (
        <OwnPieceCard piece={piece} onClose={() => setOpenSquare(null)} />
      ) : (
        <EnemyPieceCard piece={piece} onClose={() => setOpenSquare(null)} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ comuns

function usePublicConfig(): BigChessConfig | null {
  const [config, setConfig] = useState<BigChessConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadBigChessConfig().then((c) => { if (!cancelled) setConfig(c); }).catch(() => { /* defaults */ });
    return () => { cancelled = true; };
  }, []);
  return config;
}

function CardFrame({ piece, title, onClose, testId, children }: {
  piece: BigChessPieceView;
  title: string;
  onClose: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  const def = bigChessPieceFor(piece.itemKey);
  return (
    <div
      className="pointer-events-auto flex max-h-[92vh] w-[360px] max-w-full flex-col rounded-xl border-[3px] border-[#8a5a2b] bg-[#2a1a0e] text-amber-100 shadow-[0_0_0_1px_#1a0f07,0_18px_40px_rgba(0,0,0,.7)]"
      role="dialog"
      aria-label={title}
      data-testid={testId}
    >
      <div className="flex items-center gap-3 border-b border-[#8a5a2b]/70 px-4 py-3">
        <span className="flex h-14 w-12 shrink-0 items-center justify-center rounded-md border-2 border-[#6d4622] bg-[#19100a]">
          {def ? <img src={withBase(def.imageUrl)} alt="" className="max-h-12 w-auto [image-rendering:pixelated]" draggable={false} /> : <Crown className="h-6 w-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-extrabold text-amber-50">{def?.name ?? piece.itemKey}</div>
          <div className="text-[11px] text-amber-200/75">
            Casa <b className="font-mono text-amber-100">{piece.square}</b> · {title}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[#8a5a2b] bg-[#1e130a] text-amber-200 hover:bg-[#3b2411] hover:text-white"
          title="Fechar (Esc)"
          aria-label="Fechar"
          data-testid="button-close-bigchess-card"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">{children}</div>
    </div>
  );
}

function HpBar({ piece, now }: { piece: BigChessPieceView; now: number }) {
  const ratio = piece.maxHp > 0 ? Math.max(0, Math.min(1, piece.hp / piece.maxHp)) : 0;
  const color = ratio > 0.5 ? 'bg-emerald-500' : ratio > 0.2 ? 'bg-amber-400' : 'bg-red-500';
  const full = piece.hp >= piece.maxHp;
  const regenIn = piece.nextRegenAt > 0 ? Math.max(0, Math.ceil((piece.nextRegenAt - now) / 1000)) : null;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-amber-200/75">
        <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5 text-red-300" /> HP</span>
        <span className="font-mono text-amber-100" data-testid="text-bigchess-hp">{fmt.format(Math.round(piece.hp))} / {fmt.format(Math.round(piece.maxHp))}</span>
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full border border-black/60 bg-[#19100a]">
        <div className={`h-full ${color} transition-[width]`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-amber-200/70">
        {full ? 'HP cheio.' : regenIn === null ? 'Sem regeneração configurada.' : regenIn <= 0 ? 'Regenerando…' : <>Regenerando em <b className="font-mono text-amber-100">{formatBigChessDuration(regenIn)}</b> (se não for atacada)</>}
      </div>
    </div>
  );
}

function SlotChip({ slot, kind, config, now, catalog }: {
  slot: BigChessDefenseSlot;
  kind: 'cover' | 'defense';
  config: BigChessConfig | null;
  now: number;
  catalog: ReturnType<typeof useInventoryVisualCatalog>;
}) {
  const left = Math.max(0, Math.ceil((slot.expiresAt - now) / 1000));
  const effect = kind === 'cover'
    ? (config?.covers[slot.itemKey] ? `-${config.covers[slot.itemKey].damageReductionPercent}% dano` : null)
    : describeDefense(config, slot.itemKey);
  return (
    <div className="flex items-center gap-2 rounded-md border border-[#6d4622] bg-[#19100a] px-2 py-1.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-[#6d4622] bg-[#120b06]">
        <InventoryItemThumb itemKey={slot.itemKey} catalog={catalog} size={28} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-xs font-semibold text-amber-50"><InventoryItemName itemKey={slot.itemKey} catalog={catalog} /></div>
        <div className="text-[10px] text-amber-200/70">{effect ? `${effect} · ` : ''}vence em <span className="font-mono">{formatBigChessDuration(left)}</span></div>
      </div>
    </div>
  );
}

function describeDefense(config: BigChessConfig | null, itemKey: string): string | null {
  const rules = config?.defenses[itemKey];
  if (!rules) return null;
  const parts: string[] = [];
  if (rules.hpPlusPercent > 0) parts.push(`+${rules.hpPlusPercent}% HP`);
  if (rules.counterAttack) parts.push(`contra-ataque ${rules.counterAttack.damage}/s · ${rules.counterAttack.radius}px`);
  return parts.length > 0 ? parts.join(' · ') : 'defesa';
}

function StatRow({ icon, label, value, testId }: { icon: React.ReactNode; label: string; value: React.ReactNode; testId?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="flex items-center gap-1.5 text-amber-200/75">{icon} {label}</span>
      <span className="font-mono text-amber-50" data-testid={testId}>{value}</span>
    </div>
  );
}

// ------------------------------------------------------------- peça própria

function OwnPieceCard({ piece, onClose }: { piece: BigChessPieceView; onClose: () => void }) {
  const now = useNow(true);
  const config = usePublicConfig();
  const catalog = useInventoryVisualCatalog();
  const items = useCollectionInventoryStore((s) => s.items);
  const feedback = useBigChessStore((s) => s.cardFeedback);
  const pending = useBigChessStore((s) => s.pending);
  const setCardFeedback = useBigChessStore((s) => s.setCardFeedback);
  const takeRequest = useBigChessStore((s) => s.takeRequest);
  const [badges, setBadges] = useState<CraftBadgeMap | null>(null);
  const [picker, setPicker] = useState<'cover' | 'defense' | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCraftBadges().then((map) => { if (!cancelled) setBadges(map); }).catch(() => { /* sem badges: sem itens equipáveis */ });
    return () => { cancelled = true; };
  }, []);

  const collecting = Object.values(pending).some((r) => r.kind === 'collect' && r.square === piece.square);
  const equipping = Object.values(pending).some((r) => r.kind === 'equip' && r.square === piece.square);

  // Pedido sem resposta: libera o botão e avisa.
  useEffect(() => {
    const ids = Object.entries(pending).filter(([, r]) => r.square === piece.square && r.kind !== 'attack').map(([id]) => id);
    if (ids.length === 0) return;
    const timer = window.setTimeout(() => {
      let expired = false;
      for (const id of ids) if (takeRequest(id)) expired = true;
      if (expired) setCardFeedback({ kind: 'error', message: 'Sem resposta do servidor. Tente de novo.', at: Date.now() });
    }, REQUEST_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pending, piece.square, takeRequest, setCardFeedback]);

  const { income, points } = liveNumbers(piece, now);
  const collectable = Math.floor(income);
  const rules = config ? bigChessRulesFor(config, piece.itemKey) : null;
  const dominating = Math.max(0, Math.floor((now - piece.placedAt) / 1000));

  const equipables = useMemo(() => {
    if (!picker || !badges) return [];
    const badge = picker === 'cover' ? BADGE_COVER : BADGE_DEFENSE_PIECE;
    return Object.entries(items)
      .filter(([key, qty]) => qty > 0 && itemHasBadge(badges, key, badge))
      .map(([key, qty]) => ({ key, qty, configured: picker === 'cover' ? !!config?.covers[key] : !!config?.defenses[key] }))
      .sort((a, b) => Number(b.configured) - Number(a.configured) || a.key.localeCompare(b.key));
  }, [picker, badges, items, config]);

  const collect = () => {
    const bridge = getInventoryBridge();
    if (!bridge || collecting) return;
    setCardFeedback(null);
    bridge.sendChessCollect({ requestId: crypto.randomUUID(), square: piece.square });
  };

  const equip = (itemKey: string) => {
    const bridge = getInventoryBridge();
    if (!bridge || equipping) return;
    setCardFeedback(null);
    bridge.sendChessEquip({ requestId: crypto.randomUUID(), square: piece.square, itemKey });
    setPicker(null);
  };

  const defenseSlots: Array<BigChessDefenseSlot | null> = [...piece.defenses];
  while (defenseSlots.length < BIGCHESS_DEFENSE_SLOTS) defenseSlots.push(null);

  return (
    <CardFrame piece={piece} title="sua peça" onClose={onClose} testId="card-bigchess-own">
      <HpBar piece={piece} now={now} />

      {/* Defesas */}
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200/70"><Shield className="h-3.5 w-3.5" /> Defesas</div>
        <div className="space-y-1.5">
          <div className="text-[10px] text-amber-200/60">Capa (1 slot)</div>
          {piece.cover ? (
            <SlotChip slot={piece.cover} kind="cover" config={config} now={now} catalog={catalog} />
          ) : (
            <EmptySlot label="Sem capa" />
          )}
          <button
            type="button"
            onClick={() => setPicker(picker === 'cover' ? null : 'cover')}
            disabled={equipping}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border-2 border-[#6d4622] bg-[#19100a] text-xs font-semibold text-amber-200 hover:border-[#c08a4a] disabled:opacity-40"
            data-testid="button-equip-cover"
          >
            <ShieldPlus className="h-3.5 w-3.5" /> {piece.cover ? 'Renovar capa (mesmo item soma a duração)' : 'Equipar capa'}
          </button>
          {picker === 'cover' && (
            <EquipPicker items={equipables} kind="cover" config={config} catalog={catalog} onPick={equip} onClose={() => setPicker(null)} />
          )}

          <div className="pt-1 text-[10px] text-amber-200/60">Itens de defesa ({BIGCHESS_DEFENSE_SLOTS} slots)</div>
          {defenseSlots.map((slot, index) => (
            slot ? (
              <SlotChip key={`${slot.itemKey}-${index}`} slot={slot} kind="defense" config={config} now={now} catalog={catalog} />
            ) : (
              <EmptySlot key={`empty-${index}`} label={`Slot ${index + 1} livre`} />
            )
          ))}
          <button
            type="button"
            onClick={() => setPicker(picker === 'defense' ? null : 'defense')}
            disabled={equipping}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border-2 border-[#6d4622] bg-[#19100a] text-xs font-semibold text-amber-200 hover:border-[#c08a4a] disabled:opacity-40"
            data-testid="button-equip-defense"
          >
            <ShieldPlus className="h-3.5 w-3.5" /> Equipar item de defesa
          </button>
          {picker === 'defense' && (
            <EquipPicker items={equipables} kind="defense" config={config} catalog={catalog} onPick={equip} onClose={() => setPicker(null)} />
          )}
        </div>
      </div>

      {/* Renda */}
      <div className="rounded-md border border-[#6d4622] bg-[#19100a] p-2.5">
        <StatRow icon={<Coins className="h-3.5 w-3.5 text-yellow-300" />} label="Renda acumulada" value={<>{fmt1.format(income)} Crowns</>} testId="text-bigchess-income" />
        <StatRow icon={<Timer className="h-3.5 w-3.5" />} label="Renda por dia" value={<>{fmt.format(piece.incomePerDay)} Crowns</>} />
        <StatRow icon={<Coins className="h-3.5 w-3.5" />} label="Já coletado" value={<>{fmt.format(Math.floor(piece.incomeCollected))} Crowns</>} />
        <button
          type="button"
          onClick={collect}
          disabled={collecting || collectable < 1}
          className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-md border-2 border-yellow-500 bg-yellow-600 text-sm font-bold text-white shadow hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-collect-income"
        >
          {collecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
          {collecting ? 'Coletando…' : collectable >= 1 ? `Coletar ${fmt.format(collectable)} Crowns` : 'Coletar renda'}
        </button>
      </div>

      {/* Domínio */}
      <div className="rounded-md border border-[#6d4622] bg-[#19100a] p-2.5">
        <StatRow icon={<Timer className="h-3.5 w-3.5" />} label="Dominando há" value={formatBigChessDuration(dominating)} testId="text-bigchess-dominating" />
        <StatRow icon={<Swords className="h-3.5 w-3.5" />} label="Pontos totais" value={fmt1.format(points)} testId="text-bigchess-points" />
        <StatRow icon={<Swords className="h-3.5 w-3.5" />} label="Pontos por hora" value={fmt.format(piece.pointsPerHour)} />
      </div>

      {rules?.benefits && (
        <div className="rounded-md border border-[#6d4622]/70 bg-[#19100a]/60 p-2 text-[11px] leading-snug text-amber-200/80">
          <b className="text-amber-100">Benefícios:</b> {rules.benefits}
        </div>
      )}

      {feedback && (
        <div
          className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px] leading-snug ${
            feedback.kind === 'success' ? 'border-emerald-700 bg-[#0f2a1a] text-emerald-100' : 'border-red-800 bg-[#3a1512] text-red-100'
          }`}
          role="status"
          data-testid="text-bigchess-feedback"
        >
          {feedback.kind === 'success' ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}
    </CardFrame>
  );
}

function EmptySlot({ label }: { label: string }) {
  return (
    <div className="flex h-9 items-center rounded-md border border-dashed border-[#6d4622] px-2 text-[11px] text-amber-200/50">{label}</div>
  );
}

function EquipPicker({ items, kind, config, catalog, onPick, onClose }: {
  items: Array<{ key: string; qty: number; configured: boolean }>;
  kind: 'cover' | 'defense';
  config: BigChessConfig | null;
  catalog: ReturnType<typeof useInventoryVisualCatalog>;
  onPick: (itemKey: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="rounded-md border border-[#8a5a2b] bg-[#1e130a] p-2" data-testid={`picker-${kind}`}>
      <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-amber-200/70">
        <span>{kind === 'cover' ? 'Capas no inventário' : 'Itens de defesa no inventário'}</span>
        <button type="button" onClick={onClose} className="text-amber-200/70 hover:text-white" aria-label="Fechar lista"><X className="h-3.5 w-3.5" /></button>
      </div>
      {items.length === 0 ? (
        <div className="text-[11px] text-amber-200/60">
          {kind === 'cover' ? 'Nenhum item com a badge "cover" no seu inventário.' : 'Nenhum item com a badge "defense-piece" no seu inventário.'}
        </div>
      ) : (
        <div className="max-h-44 space-y-1 overflow-y-auto">
          {items.map((item) => {
            const effect = kind === 'cover'
              ? (config?.covers[item.key] ? `-${config.covers[item.key].damageReductionPercent}% dano · ${formatBigChessDuration(config.covers[item.key].durationSec)}` : null)
              : (config?.defenses[item.key] ? `${describeDefense(config, item.key)} · ${formatBigChessDuration(config.defenses[item.key].durationSec)}` : null);
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onPick(item.key)}
                className="flex w-full items-center gap-2 rounded-md border border-[#6d4622] bg-[#19100a] px-2 py-1.5 text-left hover:border-[#c08a4a]"
                data-testid={`equip-${item.key}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-[#6d4622] bg-[#120b06]">
                  <InventoryItemThumb itemKey={item.key} catalog={catalog} size={28} />
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-xs font-semibold text-amber-50"><InventoryItemName itemKey={item.key} catalog={catalog} /> <span className="font-mono text-amber-200/70">×{item.qty}</span></span>
                  <span className="block text-[10px] text-amber-200/70">{effect ?? 'Não configurado no admin (será recusado)'}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ peça adversária

function EnemyPieceCard({ piece, onClose }: { piece: BigChessPieceView; onClose: () => void }) {
  const now = useNow(true);
  const config = usePublicConfig();
  const catalog = useInventoryVisualCatalog();
  const { income, points } = liveNumbers(piece, now);
  const dominating = Math.max(0, Math.floor((now - piece.placedAt) / 1000));
  const defenses = [...(piece.cover ? [{ slot: piece.cover, kind: 'cover' as const }] : []), ...piece.defenses.map((slot) => ({ slot, kind: 'defense' as const }))];
  return (
    <CardFrame piece={piece} title={`de ${piece.ownerName || 'outro jogador'}`} onClose={onClose} testId="card-bigchess-enemy">
      <HpBar piece={piece} now={now} />
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200/70"><Shield className="h-3.5 w-3.5" /> Defesas ativas</div>
        {defenses.length === 0 ? (
          <EmptySlot label="Nenhuma defesa ativa" />
        ) : (
          <div className="space-y-1.5">
            {defenses.map(({ slot, kind }, index) => (
              <SlotChip key={`${slot.itemKey}-${index}`} slot={slot} kind={kind} config={config} now={now} catalog={catalog} />
            ))}
          </div>
        )}
        {piece.counterUntil > now && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-red-200"><AlertTriangle className="h-3.5 w-3.5" /> Contra-ataque ativo — afaste-se da casa.</div>
        )}
      </div>
      <div className="rounded-md border border-[#6d4622] bg-[#19100a] p-2.5">
        <StatRow icon={<Crown className="h-3.5 w-3.5" />} label="Dono" value={piece.ownerName || '—'} testId="text-bigchess-owner" />
        <StatRow icon={<Timer className="h-3.5 w-3.5" />} label="Dominando há" value={formatBigChessDuration(dominating)} />
        <StatRow icon={<Swords className="h-3.5 w-3.5" />} label="Pontos por hora" value={fmt.format(piece.pointsPerHour)} />
        <StatRow icon={<Swords className="h-3.5 w-3.5" />} label="Pontos totais" value={fmt1.format(points)} />
        <StatRow icon={<Coins className="h-3.5 w-3.5 text-yellow-300" />} label="Renda total" value={<>{fmt1.format(income + piece.incomeCollected)} Crowns</>} />
      </div>
      <div className="flex items-start gap-1.5 rounded-md border border-[#6d4622]/70 bg-[#19100a]/60 p-2 text-[11px] leading-snug text-amber-200/80">
        <Swords className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Para atacar, equipe uma <b className="text-amber-100">arma principal</b> e golpeie (ou atire) na casa da peça. Quando o HP zerar, a casa fica livre.</span>
      </div>
    </CardFrame>
  );
}
