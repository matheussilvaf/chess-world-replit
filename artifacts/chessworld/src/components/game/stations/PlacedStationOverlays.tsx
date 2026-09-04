/**
 * Camadas de UI das estações portáteis posicionadas:
 *   - prompt "pedir permissão" (clicou na estação de outro jogador);
 *   - pedidos recebidos pelo dono ([Permitir] / [Recusar]);
 *   - avisos curtos (permissão concedida/recusada, estação recolhida etc.).
 */
import { useEffect } from 'react';
import { AlertTriangle, Check, Info, Loader2, Lock, Send, X } from 'lucide-react';
import { usePlacedStationsStore } from '../../../stores/placedStationsStore';
import { getInventoryBridge } from '../../../game/inventory/inventoryBridge';
import { useInventoryVisualCatalog } from '../../../lib/inventory/inventoryVisualCatalog';
import { InventoryItemName, InventoryItemThumb } from '../InventoryItemVisual';
import { formatRemaining } from './PlacedStationBanner';

const NOTICE_TTL_MS = 6000;

export function PlacedStationOverlays() {
  const prompt = usePlacedStationsStore((s) => s.permissionPrompt);
  const station = usePlacedStationsStore((s) => (prompt ? s.stations[prompt.placedId] : undefined));
  const setPrompt = usePlacedStationsStore((s) => s.setPermissionPrompt);
  const updatePrompt = usePlacedStationsStore((s) => s.updatePermissionPrompt);
  const requests = usePlacedStationsStore((s) => s.accessRequests);
  const dismissRequest = usePlacedStationsStore((s) => s.dismissAccessRequest);
  const notices = usePlacedStationsStore((s) => s.notices);
  const dismissNotice = usePlacedStationsStore((s) => s.dismissNotice);
  const catalog = useInventoryVisualCatalog();

  // Avisos somem sozinhos.
  useEffect(() => {
    if (notices.length === 0) return;
    const oldest = notices[0];
    const delay = Math.max(0, oldest.createdAt + NOTICE_TTL_MS - Date.now());
    const timer = window.setTimeout(() => dismissNotice(oldest.id), delay);
    return () => window.clearTimeout(timer);
  }, [notices, dismissNotice]);

  const askPermission = () => {
    if (!prompt || !station) return;
    const bridge = getInventoryBridge();
    if (!bridge) return;
    updatePrompt(prompt.placedId, { status: 'sending', message: undefined });
    bridge.sendStationAccessRequest(prompt.placedId);
  };

  const respond = (placedId: string, requesterId: string, allow: boolean) => {
    getInventoryBridge()?.sendStationAccessResponse(placedId, requesterId, allow);
    dismissRequest(placedId, requesterId);
  };

  return (
    <>
      {/* Prompt: estação de outro jogador */}
      {prompt && station && (
        <div className="pointer-events-none fixed inset-0 z-[510] grid place-items-center p-4">
          <div
            className="pointer-events-auto w-80 max-w-full rounded-xl border-[3px] border-[#8a5a2b] bg-[#2a1a0e] p-4 text-amber-100 shadow-[0_0_0_1px_#1a0f07,0_18px_40px_rgba(0,0,0,.7)]"
            role="dialog"
            aria-label="Estação de outro jogador"
            data-testid="dialog-station-permission"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border-2 border-[#6d4622] bg-[#19100a]">
                <InventoryItemThumb itemKey={station.itemKey} catalog={catalog} size={40} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-amber-50"><InventoryItemName itemKey={station.itemKey} catalog={catalog} /></div>
                <div className="text-[11px] text-amber-200/80">de <b className="text-amber-100">{station.ownerName}</b> · {formatRemaining(station.expiresAt - Date.now())} restantes</div>
              </div>
              <button type="button" onClick={() => setPrompt(null)} className="rounded-md p-1 text-amber-200/70 hover:text-white" title="Fechar">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-md border border-[#6d4622] bg-[#19100a] px-2.5 py-2 text-[11px] leading-snug text-amber-200/85">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span>Só o dono usa esta estação. Você pode pedir permissão para <b className="text-amber-100">usar</b> (não para recolher). Depois do tempo acabar ela vira um item no chão.</span>
            </div>
            {prompt.status === 'sent' && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-200/85" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Pedido enviado — aguardando o dono responder.</div>
            )}
            {prompt.status === 'denied' && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-200" role="status"><AlertTriangle className="h-3.5 w-3.5" /> O dono recusou o pedido.</div>
            )}
            {prompt.status === 'error' && (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-200" role="alert"><AlertTriangle className="h-3.5 w-3.5" /> {prompt.message ?? 'Não foi possível pedir permissão.'}</div>
            )}
            <div className="mt-3 flex gap-1.5">
              <button
                type="button"
                onClick={askPermission}
                disabled={prompt.status === 'sending' || prompt.status === 'sent'}
                data-testid="button-request-station-access"
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border-2 border-emerald-500 bg-emerald-600 text-sm font-bold text-white shadow hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {prompt.status === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {prompt.status === 'denied' || prompt.status === 'error' ? 'Pedir de novo' : 'Pedir permissão'}
              </button>
              <button
                type="button"
                onClick={() => setPrompt(null)}
                className="flex h-10 items-center justify-center rounded-md border-2 border-[#6d4622] bg-[#19100a] px-3 text-sm text-amber-100 hover:border-[#c08a4a]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pedidos recebidos (dono) + avisos */}
      {(requests.length > 0 || notices.length > 0) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[505] flex flex-col items-center gap-2 px-3 sm:items-end sm:pr-4">
          {requests.map((request) => (
            <div
              key={`${request.placedId}:${request.requesterId}`}
              className="pointer-events-auto flex w-[340px] max-w-full items-center gap-2 rounded-xl border-[3px] border-[#8a5a2b] bg-[#2a1a0e] px-3 py-2 text-amber-100 shadow-[0_0_0_1px_#1a0f07,0_14px_32px_rgba(0,0,0,.65)]"
              role="alertdialog"
              data-testid={`toast-access-request-${request.requesterId}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-[#6d4622] bg-[#19100a]">
                <InventoryItemThumb itemKey={request.itemKey} catalog={catalog} size={30} />
              </span>
              <div className="min-w-0 flex-1 text-[11px] leading-snug">
                <b className="text-amber-50">{request.requesterName}</b> pede para usar sua{' '}
                <InventoryItemName itemKey={request.itemKey} catalog={catalog} />.
              </div>
              <button
                type="button"
                onClick={() => respond(request.placedId, request.requesterId, true)}
                data-testid="button-allow-access"
                className="flex h-8 items-center gap-1 rounded-md border-2 border-emerald-500 bg-emerald-600 px-2 text-xs font-bold text-white hover:bg-emerald-500"
              >
                <Check className="h-3.5 w-3.5" /> Permitir
              </button>
              <button
                type="button"
                onClick={() => respond(request.placedId, request.requesterId, false)}
                data-testid="button-deny-access"
                className="flex h-8 items-center gap-1 rounded-md border-2 border-[#6d4622] bg-[#19100a] px-2 text-xs font-semibold text-amber-100 hover:border-red-400 hover:text-red-200"
              >
                <X className="h-3.5 w-3.5" /> Recusar
              </button>
            </div>
          ))}
          {notices.map((notice) => (
            <div
              key={notice.id}
              className={`pointer-events-auto flex w-[340px] max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug shadow-lg ${
                notice.kind === 'error'
                  ? 'border-red-800 bg-[#3a1512] text-red-100'
                  : notice.kind === 'success'
                    ? 'border-emerald-700 bg-[#0f2a1b] text-emerald-100'
                    : 'border-[#8a5a2b] bg-[#2a1a0e] text-amber-100'
              }`}
              role="status"
            >
              {notice.kind === 'error' ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : notice.kind === 'success' ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Info className="h-3.5 w-3.5 shrink-0" />}
              <span className="flex-1">{notice.message}</span>
              <button type="button" onClick={() => dismissNotice(notice.id)} className="opacity-70 hover:opacity-100" title="Fechar">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
