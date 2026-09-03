/**
 * Modo "soltar no chão": aparece quando um item é arrastado para fora do
 * inventário (a janela já fechou).
 *
 * 1. fase 'pick' — overlay em tela cheia captura o pointerdown (o Phaser não
 *    recebe o clique, então o personagem não anda); o ícone do item segue o
 *    ponteiro; um anel no mundo mostra o alcance; o ponto é limitado ao raio.
 * 2. fase 'confirm' — popover ancorado no ponto: −, quantidade editável, +,
 *    "Tudo", Soltar / Trocar lugar / Cancelar. Cancelar reabre o inventário.
 * 3. fase 'sending' — drop enviado; espera a resposta do servidor (requestId).
 *    Recusa volta para 'confirm' com a mensagem; sucesso encerra o fluxo.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, Crosshair, Loader2, Minus, Plus, Undo2, X } from 'lucide-react';
import { useInventoryUiStore } from '../../../stores/inventoryUiStore';
import { useCollectionInventoryStore } from '../../../stores/collectionInventoryStore';
import { getInventoryBridge } from '../../../game/inventory/inventoryBridge';
import { useInventoryVisualCatalog } from '../../../lib/inventory/inventoryVisualCatalog';
import { INVENTORY_DROP_MAX_DISTANCE } from '../../../shared/collection/CollectionShapes';
import { InventoryItemName, InventoryItemThumb } from '../InventoryItemVisual';

/** Margem para o ponto nunca cair fora do raio por atraso de posição no servidor. */
const SAFE_RADIUS = INVENTORY_DROP_MAX_DISTANCE - 8;
const POPOVER_W = 264;
const POPOVER_H = 236;
const DROP_REPLY_TIMEOUT_MS = 8000;

export function InventoryDropPlacement() {
  const placement = useInventoryUiStore((s) => s.placement);
  const choosePoint = useInventoryUiStore((s) => s.choosePoint);
  const setQty = useInventoryUiStore((s) => s.setPlacementQty);
  const repick = useInventoryUiStore((s) => s.repickPoint);
  const cancel = useInventoryUiStore((s) => s.cancelPlacement);
  const finish = useInventoryUiStore((s) => s.finishPlacement);
  const markSending = useInventoryUiStore((s) => s.markSending);
  const resolvePlacement = useInventoryUiStore((s) => s.resolvePlacement);
  const available = useCollectionInventoryStore((s) => (placement ? s.items[placement.itemKey] ?? 0 : 0));
  const catalog = useInventoryVisualCatalog();
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [qtyText, setQtyText] = useState('');
  const qtyInputRef = useRef<HTMLInputElement | null>(null);

  const active = !!placement;
  const phase = placement?.phase;
  const sending = phase === 'sending';
  const pendingRequestId = sending ? placement?.requestId : undefined;
  const itemKey = placement?.itemKey;
  const qty = placement?.qty ?? 1;
  const markerX = placement && placement.phase !== 'pick' ? placement.worldX : null;
  const markerY = placement && placement.phase !== 'pick' ? placement.worldY : null;

  // Anel de alcance enquanto o modo estiver ativo (independe da quantidade digitada).
  useEffect(() => {
    const bridge = getInventoryBridge();
    if (!active || !bridge) return;
    bridge.setDropRadiusVisible(true);
    return () => bridge.setDropRadiusVisible(false);
  }, [active]);

  // Marcador só na confirmação.
  useEffect(() => {
    const bridge = getInventoryBridge();
    if (!bridge || markerX === null || markerY === null) return;
    bridge.setDropMarker({ x: markerX, y: markerY });
    return () => bridge.setDropMarker(null);
  }, [markerX, markerY]);

  // Esc cancela (menos com o drop em voo).
  useEffect(() => {
    if (!active || sending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, sending, cancel]);

  // O saldo pode mudar (coleta em andamento / outro dispositivo): se zerar, sai do modo.
  useEffect(() => {
    if (active && !sending && available <= 0) finish();
  }, [active, sending, available, finish]);

  // Servidor não respondeu ao drop: volta para a confirmação em vez de travar o jogador.
  useEffect(() => {
    if (!pendingRequestId) return;
    const timer = window.setTimeout(() => {
      resolvePlacement(pendingRequestId, { ok: false, message: 'Sem resposta do servidor. Tente de novo.' });
    }, DROP_REPLY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pendingRequestId, resolvePlacement]);

  useLayoutEffect(() => {
    setQtyText(String(qty));
  }, [qty]);

  useEffect(() => {
    if (phase === 'confirm') qtyInputRef.current?.select();
  }, [phase]);

  if (!placement || !itemKey) return null;
  const max = Math.max(1, Math.min(placement.max, available || placement.max));

  const pickPoint = (clientX: number, clientY: number) => {
    const bridge = getInventoryBridge();
    if (!bridge) { cancel(); return; }
    const world = bridge.screenToWorld(clientX, clientY);
    const player = bridge.getPlayerPosition();
    if (!world || !player) { cancel(); return; }
    let { x, y } = world;
    const dx = x - player.x;
    const dy = y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > SAFE_RADIUS) {
      const k = SAFE_RADIUS / dist;
      x = player.x + dx * k;
      y = player.y + dy * k;
    }
    const screen = bridge.worldToScreen(x, y) ?? { x: clientX, y: clientY };
    choosePoint({ worldX: x, worldY: y, screenX: screen.x, screenY: screen.y });
  };

  const confirm = () => {
    if (sending) return;
    const bridge = getInventoryBridge();
    if (!bridge) { cancel(); return; }
    const amount = Math.min(Math.max(1, Math.floor(Number(qtyText) || qty)), max);
    const requestId = crypto.randomUUID();
    markSending(requestId);
    bridge.sendDrop({
      requestId,
      itemKey,
      qty: amount,
      x: Math.round(placement.worldX),
      y: Math.round(placement.worldY),
    });
  };

  const commitQtyText = () => {
    const parsed = Math.floor(Number(qtyText));
    if (Number.isFinite(parsed) && parsed >= 1) setQty(Math.min(parsed, max));
    else setQtyText(String(qty));
  };

  // Popover sempre dentro da tela, ao lado do ponto.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(8, placement.screenX + 18), Math.max(8, vw - POPOVER_W - 8));
  const top = Math.min(Math.max(8, placement.screenY - POPOVER_H / 2), Math.max(8, vh - POPOVER_H - 8));

  return (
    <div className="fixed inset-0 z-[520]">
      {/* Camada que captura o clique no mapa (em 'confirm', clicar fora do popover troca o ponto). */}
      <div
        className="absolute inset-0 cursor-crosshair touch-none"
        onPointerMove={(event) => setPointer({ x: event.clientX, y: event.clientY })}
        onPointerLeave={() => setPointer(null)}
        onPointerDown={(event) => {
          event.preventDefault();
          if (sending) return;
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          pickPoint(event.clientX, event.clientY);
        }}
        onContextMenu={(event) => { event.preventDefault(); if (!sending) cancel(); }}
        role="presentation"
      />

      {/* Faixa de instrução */}
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3 sm:top-16">
        <div className="pointer-events-auto flex max-w-[min(96vw,520px)] items-center gap-3 rounded-xl border-[3px] border-[#8a5a2b] bg-[#2a1a0e] px-3 py-2 text-amber-100 shadow-[0_0_0_1px_#1a0f07,0_14px_32px_rgba(0,0,0,.65)]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 border-[#6d4622] bg-[#19100a]">
            <InventoryItemThumb itemKey={itemKey} catalog={catalog} size={32} />
          </span>
          <div className="min-w-0 flex-1 text-xs leading-snug">
            <div className="truncate text-sm font-bold text-amber-50"><InventoryItemName itemKey={itemKey} catalog={catalog} /></div>
            {phase === 'pick' ? (
              <div className="flex items-center gap-1 text-amber-200/80"><Crosshair className="h-3 w-3 shrink-0" /> Clique no chão, dentro do círculo, para escolher onde soltar.</div>
            ) : sending ? (
              <div className="text-amber-200/80">Soltando…</div>
            ) : (
              <div className="text-amber-200/80">Confirme a quantidade para soltar aqui.</div>
            )}
          </div>
          <button
            type="button"
            onClick={cancel}
            disabled={sending}
            className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-[#8a5a2b] bg-[#1e130a] px-2 text-xs font-semibold text-amber-200 hover:bg-[#3b2411] hover:text-white disabled:opacity-40"
            title="Cancelar e voltar ao inventário (Esc)"
          >
            <X className="h-3.5 w-3.5" /> Cancelar
          </button>
        </div>
      </div>

      {/* Ícone que segue o ponteiro */}
      {phase === 'pick' && pointer && (
        <div
          className="pointer-events-none absolute flex h-11 w-11 items-center justify-center rounded-md border-2 border-amber-300 bg-[#19100a]/95 shadow-[0_6px_18px_rgba(0,0,0,.6)]"
          style={{ left: pointer.x, top: pointer.y, transform: 'translate(-50%, -120%)' }}
          aria-hidden
        >
          <InventoryItemThumb itemKey={itemKey} catalog={catalog} size={36} />
          <ArrowDownToLine className="absolute -bottom-4 left-1/2 h-4 w-4 -translate-x-1/2 text-amber-300 drop-shadow" />
        </div>
      )}

      {/* Popover de quantidade */}
      {(phase === 'confirm' || sending) && (
        <div
          className="absolute rounded-xl border-[3px] border-[#8a5a2b] bg-[#2a1a0e] p-3 text-amber-100 shadow-[0_0_0_1px_#1a0f07,0_18px_40px_rgba(0,0,0,.7)]"
          style={{ left, top, width: POPOVER_W }}
          role="dialog"
          aria-label="Quantidade a soltar"
        >
          <div className="mb-2 flex items-center gap-2 border-b border-[#8a5a2b]/70 pb-2">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-2 border-[#6d4622] bg-[#19100a]">
              <InventoryItemThumb itemKey={itemKey} catalog={catalog} size={36} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-amber-50"><InventoryItemName itemKey={itemKey} catalog={catalog} /></div>
              <div className="text-[11px] text-amber-200/70">Você tem <b className="text-amber-100">{max}</b></div>
            </div>
          </div>

          {placement.error && (
            <div className="mb-2 flex items-start gap-1.5 rounded-md border border-red-800 bg-[#3a1512] px-2 py-1.5 text-[11px] leading-snug text-red-100" role="alert">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
              <span>{placement.error}</span>
            </div>
          )}

          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200/70">Quantidade</div>
          <div className="mt-1 flex items-stretch gap-1.5">
            <button
              type="button"
              onClick={() => setQty(qty - 1)}
              disabled={sending || qty <= 1}
              className="flex h-10 w-10 items-center justify-center rounded-md border-2 border-[#6d4622] bg-[#19100a] text-amber-100 hover:border-[#c08a4a] disabled:opacity-40"
              title="Menos"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              ref={qtyInputRef}
              type="number"
              inputMode="numeric"
              min={1}
              max={max}
              value={qtyText}
              disabled={sending}
              onChange={(event) => setQtyText(event.target.value)}
              onBlur={commitQtyText}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { commitQtyText(); confirm(); }
              }}
              className="h-10 min-w-0 flex-1 rounded-md border-2 border-[#6d4622] bg-[#19100a] text-center text-base font-bold tabular-nums text-amber-50 outline-none focus:border-amber-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={() => setQty(qty + 1)}
              disabled={sending || qty >= max}
              className="flex h-10 w-10 items-center justify-center rounded-md border-2 border-[#6d4622] bg-[#19100a] text-amber-100 hover:border-[#c08a4a] disabled:opacity-40"
              title="Mais"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setQty(max)}
              disabled={sending || qty >= max}
              className="h-10 rounded-md border-2 border-[#6d4622] bg-[#19100a] px-2 text-xs font-bold uppercase text-amber-100 hover:border-[#c08a4a] disabled:opacity-40"
              title="Soltar tudo"
            >
              Tudo
            </button>
          </div>

          <div className="mt-3 flex gap-1.5">
            <button
              type="button"
              onClick={confirm}
              disabled={sending}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border-2 border-emerald-500 bg-emerald-600 text-sm font-bold text-white shadow hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-70"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
              {sending ? 'Soltando…' : `Soltar ${qty}`}
            </button>
            <button
              type="button"
              onClick={repick}
              disabled={sending}
              className="flex h-10 items-center justify-center rounded-md border-2 border-[#6d4622] bg-[#19100a] px-2.5 text-amber-100 hover:border-[#c08a4a] disabled:opacity-40"
              title="Escolher outro lugar"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={sending}
              className="flex h-10 items-center justify-center rounded-md border-2 border-[#6d4622] bg-[#19100a] px-2.5 text-amber-100 hover:border-red-400 hover:text-red-200 disabled:opacity-40"
              title="Cancelar (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 text-[10px] leading-snug text-amber-200/55">Itens no chão podem ser pegos por qualquer jogador.</div>
        </div>
      )}
    </div>
  );
}
