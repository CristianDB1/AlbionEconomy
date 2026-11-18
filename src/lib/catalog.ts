export interface CatItem { id: string; es: string; en: string; c: string; s: string; t: number; e: number; q: number }

export const CATEGORY_LABEL: Record<string, string> = {
  weapons: 'Armas', armors: 'Armaduras', head: 'Cascos', shoes: 'Botas', capes: 'Capas',
  offhands: 'Mano secundaria', bags: 'Bolsas', mounts: 'Monturas', consumables: 'Consumibles',
  crafting: 'Recursos y refinados', gathering: 'Equipo de recolección', artefacts: 'Artefactos, runas y almas',
  farming: 'Granja', furniture: 'Mobiliario', vanity: 'Cosméticos', other: 'Otros',
};
export const CATEGORY_ORDER = ['weapons', 'armors', 'head', 'shoes', 'capes', 'offhands', 'bags', 'mounts',
  'consumables', 'crafting', 'artefacts', 'gathering', 'farming', 'furniture', 'vanity', 'other'];

let promise: Promise<CatItem[]> | null = null;
export function loadCatalog(): Promise<CatItem[]> {
  promise ??= fetch(`${import.meta.env.BASE_URL}data/catalog.json`).then((r) => {
    if (!r.ok) throw new Error('No se pudo cargar el catálogo');
    return r.json();
  });
  return promise;
}

export const QUALITY_LABEL = ['', 'Normal', 'Bueno', 'Excepcional', 'Sobresaliente', 'Obra maestra'];
export const CITIES = ['Caerleon', 'Bridgewatch', 'Fort Sterling', 'Lymhurst', 'Martlock', 'Thetford', 'Brecilien', 'Black Market'];
export const CITY_LABEL: Record<string, string> = { 'Black Market': 'Mercado Negro' };
export const cityName = (c: string) => CITY_LABEL[c] ?? c;
