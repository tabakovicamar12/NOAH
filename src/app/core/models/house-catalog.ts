/**
 * NOAH's house catalogue, as offered on the company website. An object (site) can be one of these houses or
 * have a name typed by hand. Shared by the app and the server, which only accepts ids from this list.
 */
export type HouseCategory = 'INDIVIDUAL' | 'TYPE';

export interface HouseModel {
  readonly id: string;
  readonly category: HouseCategory;
  /** Name as in the catalogue. */
  readonly name: string;
  /** Living area in m². */
  readonly area: number;
  /** Area outside the living space, e.g. a balcony, in m². */
  readonly extraArea?: number;
  /** Two flats in one house. */
  readonly twoFlats?: boolean;
}

export const HOUSE_CATEGORIES: readonly HouseCategory[] = ['INDIVIDUAL', 'TYPE'];

export const HOUSE_CATALOG: readonly HouseModel[] = [
  { id: 'individual-c', category: 'INDIVIDUAL', name: 'INDIVIDUAL-C', area: 290.7 },
  { id: 'individual-m', category: 'INDIVIDUAL', name: 'INDIVIDUAL-M', area: 99.2 },
  { id: 'individual-a', category: 'INDIVIDUAL', name: 'INDIVIDUAL-A', area: 174.6 },
  { id: 'individual-s', category: 'INDIVIDUAL', name: 'INDIVIDUAL-S', area: 346 },
  { id: 'individual-k', category: 'INDIVIDUAL', name: 'INDIVIDUAL-K', area: 142.4 },
  { id: 'vila-noah', category: 'INDIVIDUAL', name: 'VILA NOAH', area: 360 },
  { id: 'individual-g', category: 'INDIVIDUAL', name: 'INDIVIDUAL-G', area: 123 },
  { id: 'individual-d', category: 'INDIVIDUAL', name: 'INDIVIDUAL-D', area: 136 },
  { id: 'klasik-115', category: 'TYPE', name: 'KLASIK 115', area: 115 },
  { id: 'vila-245-r', category: 'TYPE', name: 'VILA 245 R', area: 245.11, extraArea: 82.72 },
  { id: 'duo-190', category: 'TYPE', name: 'DUO 190 | NOAH', area: 189.8, twoFlats: true },
  { id: 'line-176', category: 'TYPE', name: 'LINE 176', area: 176 },
  { id: 'noah-169', category: 'TYPE', name: 'NOAH 169', area: 169.38 },
];

export function houseModel(id: string | null | undefined): HouseModel | null {
  return id ? (HOUSE_CATALOG.find((m) => m.id === id) ?? null) : null;
}
