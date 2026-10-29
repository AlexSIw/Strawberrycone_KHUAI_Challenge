"""
Dust trail effect for the lion sprite.
16x16 cells, transparent, no outline / no shadow. Anchor = bottom-center (8, 15).
  dust_puff : non-directional puff (moving up / down)
  dust_side : puff that drifts backward, authored for moving RIGHT (flip it for LEFT)
"""
from PIL import Image

C = 16
PAL = {'L': (248, 242, 230), 'M': (226, 216, 198), 'D': (196, 184, 164)}

# (first row, rows)
PUFF = [
    (13, [".......LL.......",
          "......LMMM......",
          ".......DD......."]),
    (12, ["....LL...LL.....",
          "...LMMM.LMMM....",
          "...MMMD.MMMD....",
          "....DD...DD....."]),
    (10, ["......LLL.......",
          "...LL.LMMML.LL..",
          "..LMMLMMMMMLMMM.",
          "..MMMMMMMMMMMMD.",
          "...DMMDMMMDMMD..",
          "....DD..DD..D..."]),
    (8, ["......LL........",
         "..LL.LMML..LL...",
         ".LMML.MMMD.LMML.",
         ".MMMD..MD..MMMD.",
         "..DD........DD.."]),
    (6, ["......L.........",
         ".LL..LML...LL...",
         ".MD...M....MD..."]),
    (5, ["......L.........",
         ".L.........L...."]),
]

SIDE = [
    (13, [".........LL.....",
          "........LMMM....",
          ".........DD....."]),
    (12, ["......LL..LL....",
          ".....LMMMLMMM...",
          ".....MMMDMMMD...",
          "......DD..DD...."]),
    (11, ["...LL..LLL......",
          "..LMML.LMMML.LL.",
          "..MMMMMMMMMMMMD.",
          "...DMMDMMMDMMD..",
          "....DD..DD..D..."]),
    (9, [".LL..LL.........",
         "LMML.LMML.LL....",
         "MMMD.MMMD.MMD...",
         ".DD...DD..D....."]),
    (8, ["LL...LL.........",
         "MD...MD...L....."]),
    (7, ["L....L.........."]),
]


def render(spec):
    top, rows = spec
    im = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    px = im.load()
    for dy, row in enumerate(rows):
        assert len(row) == C, row
        for x, c in enumerate(row):
            if c != '.':
                px[x, top + dy] = PAL[c] + (255,)
    return im


def build():
    return {'puff': [render(s) for s in PUFF], 'side': [render(s) for s in SIDE]}
