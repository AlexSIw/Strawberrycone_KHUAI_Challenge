"""
Lion mascot -> 32x32 pixel-art sprite generator.
States: idle(4f) / run(6f) / interact(4f)  x  directions: down, left, right, up
No outline, no shadow, transparent background (RGBA 32-bit PNG).
"""
from PIL import Image

W = H = 32

PAL = {
    # mane / tail tuft
    'M': (204, 52, 43), 'm': (156, 36, 30), 'd': (120, 26, 22), 'H': (232, 86, 62),
    # fur
    'F': (236, 200, 141), 'f': (208, 164, 108), 'k': (74, 38, 24),
    # face
    'W': (250, 246, 240), 'K': (46, 28, 24), 'w': (255, 255, 255), 'N': (52, 24, 16),
    'O': (96, 30, 22), 'T': (226, 92, 50), 'P': (238, 168, 172), 'q': (128, 84, 52),
    # shirt
    'S': (248, 245, 240), 's': (210, 206, 204), 'R': (214, 52, 46), 'r': (160, 34, 32),
    'p': (228, 150, 152),
    # belt / pants / shoes
    'L': (150, 58, 56), 'G': (132, 128, 126), 'B': (36, 50, 112), 'b': (24, 32, 78),
    'Z': (244, 240, 236), 'z': (74, 44, 40), 'x': (214, 210, 208),
}

FAR = {'S': 's', 'F': 'f', 'R': 'r', 'B': 'b', 'Z': 'x'}


# ---------------------------------------------------------------- utilities
def grid(rows):
    w = max(len(r) for r in rows)
    for r in rows:
        assert len(r) == w, (rows, r)
    return [list(r) for r in rows]


def mirror(g):
    return [row[::-1] for row in g]


class Frame:
    def __init__(self):
        self.g = [[None] * W for _ in range(H)]

    def put(self, x, y, c):
        if c and c != '.' and 0 <= x < W and 0 <= y < H:
            self.g[y][x] = c

    def stamp(self, g, ox, oy, recolor=None):
        for y, row in enumerate(g):
            for x, c in enumerate(row):
                if c != '.':
                    if recolor:
                        c = recolor.get(c, c)
                    self.put(ox + x, oy + y, c)

    def image(self):
        im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        px = im.load()
        for y in range(H):
            for x in range(W):
                c = self.g[y][x]
                if c:
                    px[x, y] = PAL[c] + (255,)
        return im


def shade_mane(g):
    """dark under the face / bangs tips and along lower-right edges, light on top-left"""
    h, w = len(g), len(g[0])
    at = lambda x, y: g[y][x] if 0 <= x < w and 0 <= y < h else '.'
    out = [r[:] for r in g]
    face = set('FfWKwNOTPq')
    for y in range(h):
        for x in range(w):
            if g[y][x] != 'M':
                continue
            up, dn, lf, rt = at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)
            if up in face:                       # under the chin
                out[y][x] = 'd'
            elif dn in face:                     # bangs tips
                out[y][x] = 'm'
            elif dn == '.' or rt == '.':
                out[y][x] = 'm'
            elif (up == '.' or lf == '.') and y <= 6:
                out[y][x] = 'H'
    return out


# ---------------------------------------------------------------- heads (20 x 17)
HEAD_FRONT = shade_mane(grid([
    "......MMMMMMMM......",
    "..FF.MMMMMMMMMM.FF..",
    ".FkFMMMMMMMMMMMMFkF.",
    ".FkkMMMMMMMMMMMMkkF.",
    "..FMMMMMMMMMMMMMMF..",
    "MMMMFMMFFMMFFMMFMMMM",
    "MMMMFFqqFFFFqqFFMMMM",
    ".MMMFFFFFFFFFFFFMMM.",
    "MMMMFFwKFFFFwKFFMMMM",
    "MMMMFFKKFFFFKKFfMMMM",
    "MMMMFFFFWNNWFFFfMMMM",
    ".MMMFPPWOOOOWPPfMMM.",
    "MMMMFFFWWTTWWFFfMMMM",
    "MMMMMFFFWWWWFFfMMMMM",
    ".MMMMMffffffffMMMMM.",
    "..MMMMMMMMMMMMMMMM..",
    "....MMMMMMMMMMMM....",
]))

HEAD_SIDE = shade_mane(grid([   # facing right
    ".....MMMMMMM........",
    "..FF.MMMMMMMMM......",
    ".FFkMMMMMMMMMMM.....",
    ".FFkMMMMMMMMMMMM....",
    "..FMMMMMMMMMMMMMM...",
    "MMMMMMMMMFMMFFMMFF..",
    "MMMMMMMMFFFFFqqFFF..",
    ".MMMMMMMFFFFFFFFFF..",
    "MMMMMMMMFFFFFwKFFFF.",
    "MMMMMMMMFFFFFKKFFFF.",
    ".MMMMMMMFFFFFFFWWWN.",
    "MMMMMMMMFFFFPPWWWWW.",
    "MMMMMMMMFFFFFFWWWO..",
    ".MMMMMMMMFFFFFFWWf..",
    "..MMMMMMMMffffff....",
    "...MMMMMMMMMMMM.....",
    ".....MMMMMMMM.......",
]))

HEAD_BACK = grid([
    "......MMMMMMMM......",
    "..FF.MMMMMMMMMM.FF..",
    ".FFfMMMMMMMMMMMMfFF.",
    ".FffMMMMMMMMMMMMffF.",
    "..fMMMMMMMMMMMMMMf..",
    "MMMMMMMMMMMMMMMMMMMM",
    "MMMMMMMMMMMMMMMMMMMM",
    ".MMMMMMMMMMMMMMMMMM.",
    "MMMMMMMMMMMMMMMMMMMM",
    "MMMMMMMMMMMMMMMMMMMM",
    "MMMMMMMMMMMMMMMMMMMM",
    ".MMMMMMMMMMMMMMMMMM.",
    "MMMMMMMMMMMMMMMMMMMM",
    "MMMMMMMMMMMMMMMMMMMM",
    ".MMMMMMMMMMMMMMMMMM.",
    "..MMMMMMMMMMMMMMMMM.",
    "....MMMMMMMMMMMM....",
])
HEAD_BACK[14][18] = '.'
HEAD_BACK[15][18] = '.'
HEAD_BACK = shade_mane(HEAD_BACK)
for x, y in [(4, 7), (4, 8), (5, 9), (5, 10), (6, 11),
             (15, 7), (15, 8), (14, 9), (14, 10), (13, 11),
             (9, 13), (10, 13), (9, 14), (10, 14), (9, 15), (10, 15),
             (8, 6), (11, 6), (2, 11), (17, 11)]:
    HEAD_BACK[y][x] = 'm'
for x, y in [(7, 2), (8, 2), (11, 2), (6, 3), (5, 4)]:
    HEAD_BACK[y][x] = 'H'

HEAD = {'down': HEAD_FRONT, 'right': HEAD_SIDE, 'up': HEAD_BACK}

# ---------------------------------------------------------------- bodies
TORSO = {
    'down': grid(["SSSSSSSSSS",
                  "SRRRRRRRRS",
                  "SSRRpSRRSs",
                  "SSSSpSRRSs",
                  "SSSSpSRrSs",
                  "sSSSpSSSss"]),
    'up': grid(["SSSSSSSSSS",
                "SRRRRRRRRS",
                "SSSSSSSSSs",
                "SSSSSSSSSs",
                "SSSSSSSSSs",
                "sSSSSSSSss"]),
    'right': grid(["SSSSSSSS",
                   "SSSSSRRR",
                   "SSSSSSRp",
                   "SSSSSSSp",
                   "SSSSSSSp",
                   "sSSSSSSs"]),
}
LOWER = {   # belt + upper pants
    'down': grid(["LLLLGGLLLL",
                  "BBBBBBBBBb",
                  "BBBBbbBBBb"]),
    'up': grid(["LLLLLLLLLL",
                "BBBBBBBBBb",
                "BBBBbbBBBb"]),
    'right': grid(["LLLLLLLG",
                   "BBBBBBBB",
                   "BBBBBBBB"]),
}
TORSO_X = {'down': 11, 'up': 11, 'right': 12}

# ---------------------------------------------------------------- arms
# (grid, ax, ay): (ax, ay) = sleeve top-left inside the grid
ARM = {
    # front/back view, authored for the viewer-left arm (mirrored for the right one)
    'hang': (grid(["SS", "SS", "RR", "FF", "FF", "FF"]), 0, 0),
    'fwd': (grid(["SS.", "SS.", "RR.", ".FF", ".FF"]), 0, 0),
    'back': (grid([".SS", ".SS", ".RR", "FF."]), 1, 0),
    'reach1': (grid(["SS..", "SSR.", ".RFF", "..FF"]), 0, 0),
    'reach2': (grid(["SS...", "SS...", ".RR..", "..FF.", "..FF.", ".FFFf", ".FFFf", "..ff."]), 0, 0),
    'reach3': (grid(["SS...", "SS...", ".RR..", "..FF.", "..FF.", "..FF.", ".FFFf", ".FFFf", "..ff."]), 0, 0),
    # back view raise, viewer-right arm (not mirrored)
    'up1': (grid(["...FF", "..RFF", "SSR..", "SS..."]), 0, 2),
    'up2': (grid([".....FF", ".....FF", "....FF.", "...FF..", "..RR...", "SSR....", "SS....."]), 0, 5),
    'up3': (grid(["......FF", "......FF", ".....FF.", "....FF..", "...FF...", "..RR....", "SSR.....", "SS......"]), 0, 6),
    # side view (facing right)
    's_hang': (grid(["sS", "sS", "RR", "FF", "FF"]), 0, 0),
    's_fwd1': (grid(["sS..", "sSR.", ".RFF", "..FF"]), 0, 0),
    's_fwd2': (grid(["sSR..", "sSRFF", "...FF"]), 0, 0),
    's_back1': (grid(["..sS", ".RsS", "FFR.", "FF.."]), 2, 0),
    's_back2': (grid(["..RsS", "FFRsS", "FF..."]), 3, 0),
    's_reach1': (grid(["sSR..", "sSRFF", "...FF"]), 0, 0),
    's_reach2': (grid([".......FF", "sSRFFFFFF", "sSRFFFFFF", ".......Ff"]), 0, 1),
}


def stamp_arm(fr, name, sx, sy, mirror_it=False, far=False):
    g, ax, ay = ARM[name]
    if mirror_it:
        g = mirror(g)
        ax = len(g[0]) - 2 - ax
    fr.stamp(g, sx - ax, sy - ay, FAR if far else None)


# ---------------------------------------------------------------- tail
TAIL = {
    # (grid, ox, oy) relative to hip anchor
    'down_a': (grid(["....MM.",
                     "...MMMM",
                     "..FMMm.",
                     "FFF...."]), 21, 25),
    'down_b': (grid(["...MM..",
                     "..MMMM.",
                     "..FMMm.",
                     "FFF...."]), 21, 25),
    'right_a': (grid([".MM....",
                      "MMMM...",
                      ".mMMF..",
                      "....FFF"]), 6, 24),
    'right_b': (grid(["..MM...",
                      ".MMMM..",
                      ".mMMF..",
                      "....FFF"]), 6, 24),
    'up_a': (grid(["........MM..",
                   "........MMMM",
                   "........MMm.",
                   "FF.....FF...",
                   ".fFFFFf....."]), 15, 23),
    'up_b': (grid([".......MM...",
                   ".......MMMM.",
                   "........MMm.",
                   "FF.....FF...",
                   ".fFFFFf....."]), 15, 23),
}


def stamp_tail(fr, key, dy=0):
    g, ox, oy = TAIL[key]
    if key.startswith('up'):
        g = mirror(g)
        ox = 16 - (len(g[0]) - 1)
    g = [[('H' if c == 'M' and y == 0 else c) for c in row] for y, row in enumerate(g)]
    fr.stamp(g, ox, oy + dy)


# ---------------------------------------------------------------- legs
def leg_front(fr, x, hip_y, lift, far=False):
    """x = left col of a 4-wide pant leg"""
    foot = 31 - lift
    for y in range(hip_y, foot - 1):
        for c in range(x, x + 4):
            fr.put(c, y, 'b' if (far or c == x + 3) else 'B')
    for c in range(x, x + 4):
        fr.put(c, foot - 1, 'Z')
        fr.put(c, foot, 'z')


def leg_side(fr, x, hip_y, dx, lift, far=False):
    """x = left col of a 3-wide pant leg, toes to the right"""
    foot = 31 - lift
    ankle = x + dx
    n = (foot - 1) - hip_y
    pc = 'b' if far else 'B'
    for i in range(n):
        cx = round(x + dx * (i + 1) / (n + 1))
        for c in range(cx, cx + 3):
            fr.put(c, hip_y + i, pc)
    top = 'x' if far else 'Z'
    for c in range(ankle, ankle + 4):
        fr.put(c, foot - 1, top)
        fr.put(c, foot, 'z')


# ---------------------------------------------------------------- pose composer
def compose(view, upper=0, bob=0, head_dx=0, head_dy=0, arms=('hang', 'hang'),
            legs=None, arm_dx=0, tail='a'):
    """
    view : 'down' | 'up' | 'right'
    upper: y offset of head/torso/arms (idle breathing)
    bob  : y offset of everything above the legs (run, negative = up)
    arms : front/back -> (viewer-left, viewer-right) ; side -> (near, far)
    legs : front/back -> (left lift, right lift) ; side -> ((near dx, lift), (far dx, lift))
    """
    if legs is None:
        legs = ((0, 0), (0, 0)) if view == 'right' else (0, 0)
    fr = Frame()
    hip_y = 28 + bob
    ty = 19 + bob + upper
    hx, hy = 6 + head_dx, 3 + bob + upper + head_dy
    tx = TORSO_X[view]

    if view == 'down':
        stamp_tail(fr, 'down_' + tail, bob)
        leg_front(fr, 11, hip_y, legs[0])
        leg_front(fr, 17, hip_y, legs[1])
        fr.stamp(LOWER['down'], 11, 25 + bob)
        fr.stamp(TORSO['down'], tx, ty)
        stamp_arm(fr, arms[0], 9, ty)
        stamp_arm(fr, arms[1], 21, ty, mirror_it=True)
        fr.stamp(HEAD['down'], hx, hy)
    elif view == 'up':
        leg_front(fr, 11, hip_y, legs[0])
        leg_front(fr, 17, hip_y, legs[1])
        fr.stamp(LOWER['up'], 11, 25 + bob)
        fr.stamp(TORSO['up'], tx, ty)
        stamp_arm(fr, arms[0], 9, ty)
        if arms[1].startswith('up'):
            stamp_arm(fr, arms[1], 21, ty)
        else:
            stamp_arm(fr, arms[1], 21, ty, mirror_it=True)
        stamp_tail(fr, 'up_' + tail, bob)
        fr.stamp(HEAD['up'], hx, hy)
    else:
        (ndx, nl), (fdx, fl) = legs
        near_arm, far_arm = arms
        stamp_tail(fr, 'right_' + tail, bob)
        stamp_arm(fr, far_arm, 16, ty + 1, far=True)
        leg_side(fr, 16, hip_y, fdx, fl, far=True)
        fr.stamp(LOWER['right'], 12, 25 + bob)
        fr.stamp(TORSO['right'], tx, ty)
        leg_side(fr, 13, hip_y, ndx, nl)
        stamp_arm(fr, near_arm, 15 + arm_dx, ty + 1)
        fr.stamp(HEAD['right'], hx, hy)
    return fr


# ---------------------------------------------------------------- animations
def anim_idle(view):
    seq = [(0, 'a'), (0, 'a'), (1, 'b'), (1, 'b')]
    return [compose(view, upper=u, tail=t) for u, t in seq]


def anim_run(view):
    if view in ('down', 'up'):
        # (left lift, right lift, bob, left arm, right arm, tail)
        seq = [(0, 2, 0, 'fwd', 'back', 'a'), (0, 1, -1, 'fwd', 'back', 'b'),
               (0, 0, 0, 'hang', 'hang', 'a'), (2, 0, 0, 'back', 'fwd', 'b'),
               (1, 0, -1, 'back', 'fwd', 'a'), (0, 0, 0, 'hang', 'hang', 'b')]
        return [compose(view, bob=b, arms=(al, ar), legs=(ll, rl), tail=t)
                for ll, rl, b, al, ar, t in seq]
    seq = [((2, 0), (-2, 1), 0, 's_back2', 's_fwd2', 'a'),
           ((1, 0), (-1, 2), 0, 's_back1', 's_fwd1', 'b'),
           ((0, 0), (1, 2), -1, 's_hang', 's_hang', 'a'),
           ((-2, 1), (2, 0), 0, 's_fwd2', 's_back2', 'b'),
           ((-1, 2), (1, 0), 0, 's_fwd1', 's_back1', 'a'),
           ((1, 2), (0, 0), -1, 's_hang', 's_hang', 'b')]
    return [compose(view, bob=b, arms=(na, fa), legs=(n, f), tail=t) for n, f, b, na, fa, t in seq]


def anim_interact(view):
    if view == 'down':
        seq = [('reach1', 0), ('reach2', 1), ('reach3', 1), ('reach1', 0)]
        return [compose(view, head_dy=hd, arms=(a, 'hang')) for a, hd in seq]
    if view == 'up':
        seq = ['up1', 'up2', 'up3', 'up1']
        return [compose(view, arms=('hang', a)) for a in seq]
    seq = [('s_reach1', 0, 0), ('s_reach2', 0, 0), ('s_reach2', 1, 1), ('s_reach1', 0, 0)]
    return [compose(view, head_dx=hdx, arm_dx=adx, arms=(a, 's_hang')) for a, hdx, adx in seq]


STATES = [('idle', anim_idle), ('run', anim_run), ('interact', anim_interact)]
DIRS = ['down', 'left', 'right', 'up']


def build_all():
    out = {}
    for sname, fn in STATES:
        out[sname] = {}
        for d in DIRS:
            if d == 'left':
                ims = [f.image().transpose(Image.FLIP_LEFT_RIGHT) for f in fn('right')]
            else:
                ims = [f.image() for f in fn(d)]
            out[sname][d] = ims
    return out


def review(path, scale=10):
    anims = build_all()
    rows = [(s, d) for s, _ in STATES for d in DIRS]
    pad = 6
    sheet = Image.new('RGBA', (6 * (32 * scale + pad) + pad, len(rows) * (32 * scale + pad) + pad),
                      (60, 64, 76, 255))
    for ri, (s, d) in enumerate(rows):
        for ci, im in enumerate(anims[s][d]):
            big = im.resize((32 * scale, 32 * scale), Image.NEAREST)
            bg = Image.new('RGBA', big.size, (128, 172, 120, 255))
            bg.alpha_composite(big)
            sheet.paste(bg, (pad + ci * (32 * scale + pad), pad + ri * (32 * scale + pad)))
    sheet.save(path)


if __name__ == '__main__':
    review('review.png', 6)
    print('ok')
