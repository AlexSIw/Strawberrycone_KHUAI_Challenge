// Fixed coordinates of the NMS topology map (SVG user units). No layout engine: the network's shape is
// known (topology.ts), so every device has its place.
//
//                         인터넷
//              BR-01                 BR-02
//              FW-01                 FW-02
//   L4-01      CORE-01 ─────────── CORE-02      L4-02
//      TOR-01        TOR-02     CAMPUS-ENG  CAMPUS-LIB  CAMPUS-MAIN
//      [servers]     [servers]   공학관      중앙도서관     본관

export const VIEW = { w: 900, h: 392 };
export const BOX = { w: 104, h: 32 };

export const POS: Record<string, { x: number; y: number }> = {
  internet: { x: 450, y: 26 },
  'BR-01': { x: 330, y: 88 },
  'BR-02': { x: 570, y: 88 },
  'FW-01': { x: 330, y: 150 },
  'FW-02': { x: 570, y: 150 },
  'CORE-01': { x: 330, y: 216 },
  'CORE-02': { x: 570, y: 216 },
  'L4-01': { x: 110, y: 216 },
  'L4-02': { x: 790, y: 216 },
  'TOR-01': { x: 170, y: 300 },
  'TOR-02': { x: 360, y: 300 },
  'CAMPUS-ENG': { x: 556, y: 300 },
  'CAMPUS-LIB': { x: 676, y: 300 },
  'CAMPUS-MAIN': { x: 796, y: 300 },
};

/** Server boxes hang under their TOR in one row. */
export const SERVER_ROW = { y: 352, w: 16, h: 13, gap: 4 };
