import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { usePlayerCharacterStore } from '../../stores/playerCharacterStore';
import { fetchPublicAssetCategories } from '../../lib/playerCharacterApi';
import { findClassWeaponRef } from '../../shared/characters/PlayerCharacterShapes';

export function EquipmentButton() {
 const c=usePlayerCharacterStore(s=>s.character), open=usePlayerCharacterStore(s=>s.panelOpen), set=usePlayerCharacterStore(s=>s.setPanelOpen);
 return c ? <button type="button" title="Equipamento" onClick={()=>set(!open)} className="fixed bottom-3 right-3 z-[120] h-12 w-12 rounded-md border-2 border-[#8a5a2b] bg-[#2b1c10]/95 text-amber-100 shadow-lg">Equip.</button> : null;
}
export function EquipmentPanel() {
 const c=usePlayerCharacterStore(s=>s.character), open=usePlayerCharacterStore(s=>s.panelOpen), set=usePlayerCharacterStore(s=>s.setPanelOpen), live=usePlayerCharacterStore(s=>s.liveWeapon), send=usePlayerCharacterStore(s=>s.equipSender);
 const [weapon,setWeapon]=useState<string|null>(null);
 useEffect(()=>{if(c&&open) void fetchPublicAssetCategories().then(x=>setWeapon(findClassWeaponRef(x,c.classId))).catch(()=>setWeapon(null));},[c,open]);
 if(!c||!open)return null; const equipped=!!weapon&&live===weapon;
 return <div className="fixed bottom-[70px] right-3 z-[150] w-72 rounded-lg border-4 border-[#8a5a2b] bg-[#2b1c10] p-4 shadow-2xl"><div className="flex justify-between border-b border-[#8a5a2b] pb-2"><b className="uppercase tracking-wider text-amber-200">Equipamento</b><button onClick={()=>set(false)}><X className="h-5 w-5 text-amber-100"/></button></div><p className="mt-4 text-xs uppercase text-amber-200/70">Arma da classe</p><button disabled={!weapon||!send} onClick={()=>send?.(!equipped,weapon??undefined)} className={`mt-2 flex h-20 w-full items-center justify-center rounded border-2 text-sm ${equipped?'border-emerald-500 text-emerald-100':'border-[#6b4a26] text-amber-100'}`}>{weapon ? (equipped?'Arma equipada':'Equipar arma padrão'):'Nenhuma arma padrão configurada'}</button>{equipped&&<button onClick={()=>send?.(false)} className="mt-3 text-xs text-amber-200 underline">Desequipar</button>}</div>;
}