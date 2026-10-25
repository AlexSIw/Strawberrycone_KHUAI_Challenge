// Data-center floor plan. Everything is in tile units (TILE px each) unless a name says "Px".
import type { SpotId } from '../content/types';
import type { RoomId } from '../sim/types';

export const TILE = 48;
export const MAP_W = 40;
export const MAP_H = 26;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export type AreaId = RoomId | 'corridor';

export interface RoomDef {
  id: AreaId;
  name: string;
  /** Inclusive tile rect. The row that touches the corridor is the wall with the door in it. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Door opening (2 tiles wide) in the wall row facing the corridor */
  door: { x: number; y: number; w: number } | null;
  /** Centre of the room name painted on the floor (tile units, may be fractional) */
  label: { x: number; y: number };
  /** Floor texture family */
  floor: string;
}

export const ROOMS: RoomDef[] = [
  { id: 'server', name: '서버실', x0: 1, y0: 1, x1: 16, y1: 11, door: { x: 8, y: 11, w: 2 }, label: { x: 9, y: 8.5 }, floor: 'server' },
  { id: 'network', name: '네트워크실', x0: 18, y0: 1, x1: 27, y1: 11, door: { x: 22, y: 11, w: 2 }, label: { x: 24.5, y: 9.5 }, floor: 'network' },
  { id: 'cooling', name: '냉각실', x0: 29, y0: 1, x1: 38, y1: 11, door: { x: 33, y: 11, w: 2 }, label: { x: 33.5, y: 8.5 }, floor: 'cooling' },
  { id: 'corridor', name: '복도', x0: 1, y0: 12, x1: 38, y1: 14, door: null, label: { x: 9, y: 13 }, floor: 'corridor' },
  { id: 'power', name: '전기실 (UPS·분전반)', x0: 1, y0: 15, x1: 12, y1: 24, door: { x: 6, y: 15, w: 2 }, label: { x: 6.5, y: 22 }, floor: 'power' },
  // The floor label sits a little low so it stays clear of the desks, inside the default 900 px tall view.
  { id: 'noc', name: '관제실 (NOC)', x0: 14, y0: 15, x1: 38, y1: 24, door: { x: 17, y: 15, w: 2 }, label: { x: 25, y: 22 }, floor: 'noc' },
];

export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r) => [r.id, r])) as Record<AreaId, RoomDef>;

/** Which room (or the corridor) a tile belongs to; null for the walls between rooms and outside. */
export function roomAt(tx: number, ty: number): AreaId | null {
  for (const r of ROOMS) {
    if (tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1) return r.id;
  }
  return null;
}

function isDoor(tx: number, ty: number): boolean {
  return ROOMS.some((r) => r.door && ty === r.door.y && tx >= r.door.x && tx < r.door.x + r.door.w);
}

/** Wall tiles: outer walls, the wall rows facing the corridor, and the walls between rooms. */
export function isWall(tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  if (tx === 0 || ty === 0 || tx === MAP_W - 1 || ty === MAP_H - 1) return true;
  if ((ty === 11 || ty === 15) && !isDoor(tx, ty)) return true;
  if ((tx === 17 || tx === 28) && ty <= 11) return true;
  if (tx === 13 && ty >= 15) return true;
  return false;
}

export function isDoorTile(tx: number, ty: number): boolean {
  return isDoor(tx, ty);
}

export interface SpotDef {
  id: SpotId;
  /** Footprint (tiles); the player collides with it */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Name shown in the "[E] …" prompt */
  label: string;
}

export const SPOTS: SpotDef[] = [
  { id: 'rack1', x: 3, y: 3, w: 2, h: 3, label: '랙 1' },
  { id: 'rack2', x: 6, y: 3, w: 2, h: 3, label: '랙 2' },
  { id: 'rack3', x: 9, y: 3, w: 2, h: 3, label: '랙 3' },
  { id: 'rack4', x: 12, y: 3, w: 2, h: 3, label: '랙 4' },
  { id: 'switch', x: 20, y: 3, w: 2, h: 2, label: '코어 스위치' },
  { id: 'router', x: 24, y: 3, w: 2, h: 2, label: '보더 라우터·방화벽' },
  { id: 'patch', x: 20, y: 7, w: 2, h: 2, label: '패치 패널' },
  { id: 'crac', x: 32, y: 3, w: 3, h: 3, label: '항온항습기(CRAC)' },
  { id: 'pdu', x: 3, y: 18, w: 2, h: 2, label: 'PDU (분전반)' },
  { id: 'ups', x: 7, y: 18, w: 2, h: 2, label: 'UPS (무정전 전원장치)' },
  { id: 'monitor', x: 20, y: 16, w: 3, h: 1, label: '관제 화면' },
  { id: 'desk', x: 25, y: 18, w: 2, h: 1, label: '관리 PC' },
  { id: 'mentor', x: 30, y: 19, w: 1, h: 1, label: '쿠사수' },
  { id: 'board', x: 34, y: 16, w: 2, h: 1, label: '설계 보드' },
];

export const SPOT_BY_ID = Object.fromEntries(SPOTS.map((s) => [s.id, s])) as Record<SpotId, SpotDef>;

export const RACK_SPOTS: { spot: SpotId; rack: string }[] = [
  { spot: 'rack1', rack: 'rack1' },
  { spot: 'rack2', rack: 'rack2' },
  { spot: 'rack3', rack: 'rack3' },
  { spot: 'rack4', rack: 'rack4' },
];

/** Player spawn tile (corridor, right outside the NOC door). */
export const PLAYER_SPAWN = { x: 19, y: 13 };

export interface DecorDef {
  tex: string;
  /** Tile position of the decoration's footprint (bottom-centre anchored on x + 0.5, y + 1) */
  x: number;
  y: number;
  solid?: boolean;
  /** Drawn above the player (overhead things like cable trays) */
  overhead?: boolean;
}

export const DECOR: DecorDef[] = [
  // plants
  { tex: 'plant', x: 1, y: 10, solid: true },
  { tex: 'plant', x: 16, y: 10, solid: true },
  { tex: 'plant', x: 27, y: 10, solid: true },
  { tex: 'plant', x: 38, y: 10, solid: true },
  { tex: 'plant', x: 14, y: 24, solid: true },
  { tex: 'plant', x: 38, y: 24, solid: true },
  { tex: 'plant', x: 1, y: 24, solid: true },
  // spare parts
  { tex: 'box', x: 37, y: 2, solid: true },
  { tex: 'box', x: 38, y: 2, solid: true },
  { tex: 'box', x: 12, y: 24, solid: true },
  { tex: 'box', x: 11, y: 24, solid: true },
  { tex: 'box', x: 27, y: 2, solid: true },
  // NOC furniture
  { tex: 'chair', x: 25, y: 19 },
  { tex: 'chair', x: 21, y: 17 },
  { tex: 'water', x: 37, y: 16, solid: true },
];

/** Overhead cable trays (one texture per tile, drawn above the player). */
export const TRAYS: { x0: number; x1: number; y: number }[] = [
  { x0: 2, x1: 15, y: 2 },
  { x0: 18, x1: 27, y: 2 },
];

/** Where cardboard boxes appear for servers that are not mounted yet (D-5). */
export const UNBOXED_SPOTS = [
  { x: 13, y: 8 },
  { x: 14, y: 8 },
  { x: 13, y: 9 },
  { x: 14, y: 9 },
];

/** Merge wall tiles into horizontal runs so the physics world has few bodies. */
export function wallRects(): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let ty = 0; ty < MAP_H; ty++) {
    let start = -1;
    for (let tx = 0; tx <= MAP_W; tx++) {
      const solid = tx < MAP_W && isWall(tx, ty);
      if (solid && start < 0) start = tx;
      if (!solid && start >= 0) {
        out.push({ x: start, y: ty, w: tx - start, h: 1 });
        start = -1;
      }
    }
  }
  return out;
}

/** Pixel rect of a spot's footprint. */
export function spotRectPx(s: SpotDef) {
  return { x: s.x * TILE, y: s.y * TILE, w: s.w * TILE, h: s.h * TILE };
}
