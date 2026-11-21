export type ResidentOutfit = 'everyday' | 'hoodie';

export interface ResidentOutfitSpec {
  id: ResidentOutfit;
  label: string;
  modelPath: string;
  contactPath: string;
}

export const WARDROBE_STORAGE_KEY = 'pocketworld:wardrobe:outfit';

export const RESIDENT_OUTFITS: readonly ResidentOutfit[] = ['everyday', 'hoodie'];

export const OUTFIT_CATALOG: Readonly<Record<ResidentOutfit, ResidentOutfitSpec>> = {
  everyday: {
    id: 'everyday',
    label: '日常裙装',
    modelPath: 'models/resident/luna-walk-room.glb',
    contactPath: 'models/resident/luna-seat-contact.bin',
  },
  hoodie: {
    id: 'hoodie',
    label: '云朵连帽衫',
    modelPath: 'models/resident/luna-cloud-hoodie.glb',
    contactPath: 'models/resident/luna-cloud-hoodie-seat.bin',
  },
};

export function parseOutfit(value: string | null | undefined): ResidentOutfit | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'everyday' || normalized === 'dress') return 'everyday';
  if (normalized === 'hoodie' || normalized === 'cloud-hoodie' || normalized === 'cloudhoodie') return 'hoodie';
  return null;
}

export function previewOutfit(search: string): ResidentOutfit | null {
  try {
    return parseOutfit(new URLSearchParams(search).get('outfit'));
  } catch {
    return null;
  }
}

export function readStoredOutfit(storage?: Pick<Storage, 'getItem'> | null): ResidentOutfit | null {
  try {
    const target = storage === undefined
      ? (typeof window !== 'undefined' ? window.localStorage : null)
      : storage;
    return parseOutfit(target?.getItem(WARDROBE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function initialOutfit(
  search = typeof window !== 'undefined' ? window.location.search : '',
  storage?: Pick<Storage, 'getItem'> | null,
): ResidentOutfit {
  return previewOutfit(search) ?? readStoredOutfit(storage) ?? 'everyday';
}

export function rememberOutfit(
  outfit: ResidentOutfit,
  storage?: Pick<Storage, 'setItem'> | null,
): void {
  try {
    const target = storage === undefined
      ? (typeof window !== 'undefined' ? window.localStorage : null)
      : storage;
    target?.setItem(WARDROBE_STORAGE_KEY, outfit);
  } catch {
    // Ignore storage quota / privacy mode failures; runtime switching still works.
  }
}

export function nextOutfit(current: ResidentOutfit): ResidentOutfit {
  return current === 'everyday' ? 'hoodie' : 'everyday';
}

export function outfitLabel(outfit: ResidentOutfit): string {
  return OUTFIT_CATALOG[outfit].label;
}

export function outfitActionHint(current: ResidentOutfit): string {
  return current === 'everyday' ? '换上云朵连帽衫' : '换回日常裙装';
}

export function outfitLoadingNotice(next: ResidentOutfit): string {
  return `正在换上${outfitLabel(next)}…`;
}

export function outfitSwitchedNotice(next: ResidentOutfit): string {
  return next === 'everyday' ? '已换回日常裙装' : `已换上${outfitLabel(next)}`;
}

export function outfitErrorNotice(failed: ResidentOutfit): string {
  return `${outfitLabel(failed)}加载失败，请稍后重试`;
}
