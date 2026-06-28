import { atom } from "nanostores"
export const $memories = atom<any[]>([])
export const $diaryEntries = atom<any[]>([])
export const $assetsByType = atom<Record<string, any[]>>({})
