import { useState, useEffect, useCallback, useMemo } from 'react';
import { Backpack, X, Loader2, Copy, Check } from 'lucide-react';
import { useCollectionInventoryStore } from '../../stores/collectionInventoryStore';
import { COLLECTIBLE_ITEM_KEYS } from '../../shared/collection/CollectionShapes';

const ICON_MAP: Record<string, string> = {
  'mineral:pedra': '/assets/CraftingWorld/resources/minerals/drop/drop-stone.png',
  'mineral:carvao': '/assets/CraftingWorld/resources/minerals/drop/drop-coal.png',
  'mineral:ferro': '/assets/CraftingWorld/resources/minerals/drop/drop-iron.png',
  'mineral:cobre': '/assets/CraftingWorld/resources/minerals/drop/drop-copper.png',
  'mineral:ouro': '/assets/CraftingWorld/resources/minerals/drop/drop-gold.png',
  'mineral:diamante': '/assets/CraftingWorld/resources/minerals/drop/drop-diamond.png',
  'mineral:cristal_real': '/assets/CraftingWorld/resources/minerals/drop/drop-cristal-real.png',
  'tree:pinheiro_peao': '/assets/CraftingWorld/resources/tronco/drop-pinheiro-peao.png',
  'tree:carvalho_torre': '/assets/CraftingWorld/resources/tronco/drop-carvalho-torre.png',
  'tree:freixo_cavalo': '/assets/CraftingWorld/resources/tronco/drop-freixo-cavalo.png',
  'tree:ebano_dama': '/assets/CraftingWorld/resources/tronco/drop-ebano-dama.png',
  'tree:salgueiro_bispo': '/assets/CraftingWorld/resources/tronco/drop-salgueiro-bispo.png',
  'herb:heal_herb': '/assets/CraftingWorld/resources/ervas e plantas/heal_herb.png',
  'herb:red_herb': '/assets/CraftingWorld/resources/ervas e plantas/red_herb.png',
  'herb:blue_herb': '/assets/CraftingWorld/resources/ervas e plantas/blue_herb.png',
  'herb:queen_thorn': '/assets/CraftingWorld/resources/ervas e plantas/queen_thorn.png',
  'herb:horse_root': '/assets/CraftingWorld/resources/ervas e plantas/horse_root.png',
  'bush': '/assets/CraftingWorld/resources/ervas e plantas/bush.png',
  'hand_stone': '/assets/CraftingWorld/resources/minerals/stone-hand-collected.png',
};

const TITLE_MAP: Record<string, string> = {
  'mineral:pedra': 'Pedra',
  'mineral:carvao': 'Carvão',
  'mineral:ferro': 'Ferro',
  'mineral:cobre': 'Cobre',
  'mineral:ouro': 'Ouro',
  'mineral:diamante': 'Diamante',
  'mineral:cristal_real': 'Cristal Real',
  'tree:pinheiro_peao': 'Tronco de Pinheiro Peão',
  'tree:carvalho_torre': 'Tronco de Carvalho Torre',
  'tree:freixo_cavalo': 'Tronco de Freixo Cavalo',
  'tree:ebano_dama': 'Tronco de Ébano Dama',
  'tree:salgueiro_bispo': 'Tronco de Salgueiro Bispo',
  'herb:heal_herb': 'Erva da Cura',
  'herb:red_herb': 'Erva Vermelha',
  'herb:blue_herb': 'Erva Azul',
  'herb:queen_thorn': 'Espinho da Dama',
  'herb:horse_root': 'Raiz do Cavalo',
  'bush': 'Arbusto',
  'hand_stone': 'Pedra Pequena',
};

export function CollectionInventoryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Inventário de Coleta"
      className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-slate-900/90 backdrop-blur-sm border border-slate-700/50 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-all pointer-events-auto"
    >
      <Backpack className="w-4 h-4" />
    </button>
  );
}

export function CollectionInventoryPanel({ onClose }: { onClose: () => void }) {
  const { items, loaded, loading, error, tableMissing, tableSql, refresh } = useCollectionInventoryStore();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleCopy = useCallback(() => {
    if (tableSql) {
      navigator.clipboard.writeText(tableSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [tableSql]);

  const filledItems = useMemo(() => {
    return COLLECTIBLE_ITEM_KEYS.filter((key) => (items[key] || 0) > 0).map((key) => ({
      key,
      qty: items[key],
    }));
  }, [items]);

  const totalSlots = Math.max(20, Math.ceil(filledItems.length / 5) * 5);
  const slots = Array.from({ length: totalSlots });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-auto">
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md bg-slate-900/95 border border-slate-700/50 rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/50">
          <h2 className="text-white font-medium">Inventário de Coleta</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          {loading && !loaded ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {tableMissing && (
                <div className="bg-amber-950/40 border border-amber-900/50 rounded-lg p-3 text-amber-200/90 text-sm">
                  <p className="font-medium mb-2">A tabela do inventário ainda não foi criada no Supabase.</p>
                  {tableSql && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-amber-400/80 hover:text-amber-300 select-none">
                        Ver SQL
                      </summary>
                      <div className="mt-2 relative">
                        <pre className="text-[11px] bg-slate-950/80 p-3 rounded overflow-x-auto text-amber-100/70 border border-amber-900/30">
                          {tableSql}
                        </pre>
                        <button
                          onClick={handleCopy}
                          className="absolute top-2 right-2 p-1.5 bg-slate-800 rounded hover:bg-slate-700 text-slate-300 transition-colors"
                          title="Copiar SQL"
                        >
                          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </details>
                  )}
                </div>
              )}

              {error && !tableMissing && (
                <div className="text-red-400 text-sm bg-red-950/30 border border-red-900/30 rounded p-3">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-5 gap-2">
                {slots.map((_, i) => {
                  const item = filledItems[i];
                  return (
                    <div
                      key={i}
                      className="relative w-14 h-14 bg-slate-950 border border-slate-800 rounded-md flex items-center justify-center overflow-hidden group"
                      title={item ? TITLE_MAP[item.key] || item.key : undefined}
                    >
                      {item && (
                        <>
                          {item.key === 'hand_stone' ? (
                            <div
                              className="w-[32px] h-[32px]"
                              style={{
                                backgroundImage: `url("${encodeURI(ICON_MAP[item.key])}")`,
                                backgroundPosition: '0 0',
                                imageRendering: 'pixelated',
                              }}
                            />
                          ) : (
                            <img
                              src={encodeURI(ICON_MAP[item.key] || '')}
                              alt={item.key}
                              className="max-w-[80%] max-h-[80%] object-contain"
                              style={{ imageRendering: 'pixelated' }}
                            />
                          )}
                          <div className="absolute bottom-0 right-0 bg-slate-950/80 px-1 min-w-[16px] text-center rounded-tl text-[10px] font-bold text-white leading-tight pb-px">
                            {item.qty}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
