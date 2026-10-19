// The walkable data center: floor plan, equipment with live LEDs, the lion, the mentor and incident markers.
import Phaser from 'phaser';
import { getStage } from '../../content/stages';
import type { InteractionKind, SpotId, StageDef } from '../../content/types';
import { activeScenarios, type StageRun } from '../../sim/engine';
import type { World } from '../../sim/types';
import { gameStore, type GameState } from '../../store/game';
import { EventBus } from '../EventBus';
import {
  DECOR,
  isWall,
  MAP_H,
  MAP_W,
  PLAYER_SPAWN,
  RACK_SPOTS,
  ROOM_BY_ID,
  ROOMS,
  roomAt,
  SPOT_BY_ID,
  SPOTS,
  TILE,
  TRAYS,
  UNBOXED_SPOTS,
  wallRects,
  WORLD_H,
  WORLD_W,
  type AreaId,
  type SpotDef,
} from '../map';
import { facingFor, LION_FEET_Y, LION_FRAME, LION_SCALE, lionLook, type Facing } from '../sprites/lion';
import {
  BOARD_TEX,
  CABINET_TEX,
  CRAC_TEX,
  DESK_TEX,
  MONITOR_SCREENS,
  MONITOR_TEX,
  PATCH_LED,
  PDU_LEDS,
  RACK_TEX,
  ROUTER_LEDS,
  switchLed,
  UPS_LCD,
  UPS_LED,
} from '../textures';
import {
  blackout,
  cracOk,
  LED_COLOR,
  patchLed,
  pduLeds,
  rackSlots,
  rackTemp,
  routerLeds,
  SWITCH_PORTS,
  switchPortLeds,
  unmountedServers,
  upsView,
  type LedState,
} from '../worldView';

const SPEED = 210;
/** Max distance from the lion's feet to a device's footprint for the [E] prompt */
const INTERACT_RANGE = TILE * 1.1;
const FONT = 'Galmuri11, "Noto Sans KR", monospace';
/** Screen px covered by the React ObjectivePanel (8 px margin + 300 px wide) and the HUD (top). */
const PANEL_W = 308;
const HUD_H = 56;

const DEPTH = { floor: 0, wallDecor: 2, label: 3, overhead: 5000, overlay: 6000, marker: 7000, prompt: 8000, arrow: 8500 };

// Verbs stay neutral ("전원 설정", not "UPS 연결하기") so the prompt never hints at an incident's answer.
const VERB: Record<InteractionKind['kind'], string> = {
  rack: '서버 장착하기',
  cable: '케이블 연결하기',
  power: '전원 설정',
  console: '콘솔 접속',
  consolePick: '콘솔 접속',
  terminal: '터미널 열기',
  dashboard: '대시보드 보기',
  mentor: '말 걸기',
  repair: '수리하기',
  board: '열기',
  quiz: '퀴즈 풀기',
  inspect: '살펴보기',
};

function verbFor(k: InteractionKind, cracWorking: boolean): string {
  if (k.kind === 'cable' && k.mode === 'repair') return '케이블 점검';
  if (k.kind === 'console') return `콘솔 접속 (${k.host})`;
  if (k.kind === 'repair' && cracWorking) return '점검하기';
  return VERB[k.kind];
}

/** How far a spot's sprite sticks up above its footprint (for placing the prompt). */
const OVERHANG: Partial<Record<SpotId, number>> = { monitor: 48, board: 48, mentor: 18 };

const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const isBlocked = (s: GameState) => !!s.modal || !!s.dialogue || s.screen !== 'playing' || s.concepts.length > 0;

/** store.play() just started a new run (it switches to 'playing' and opens the intro dialogue). */
function isFreshRun(s: GameState, prev: GameState): boolean {
  if (!s.run || s.run === prev.run) return false;
  return (s.screen === 'playing' && prev.screen !== 'playing') || (s.dialogue?.then === 'play' && prev.dialogue?.then !== 'play');
}

function hash(x: number, y: number): number {
  return ((x * 73856093) ^ (y * 19349663)) >>> 0;
}

function floorKey(area: AreaId | null, tx: number, ty: number): string {
  const room = ROOM_BY_ID[area ?? 'corridor'];
  if (room.id === 'corridor' && ty === 13) return 'floor-corridor-stripe';
  let v: number;
  if (room.id === 'server') v = ty >= 6 && ty <= 7 ? 0 : 1; // perforated "cold aisle" tiles in front of the racks
  else if (room.id === 'network' || room.id === 'noc') v = (tx + ty) % 2;
  else v = hash(tx, ty) % 3 === 0 ? 1 : 0;
  return `floor-${room.floor}-${v}`;
}

interface Led {
  rect: Phaser.GameObjects.Rectangle;
  state: LedState;
  phase: number;
}

interface RackView {
  rack: string;
  left: number;
  top: number;
  depth: number;
  image: Phaser.GameObjects.Image;
  sig: string;
  parts: Phaser.GameObjects.GameObject[];
  units: Phaser.GameObjects.Image[];
  leds: Led[];
  temp: Phaser.GameObjects.Text;
}

interface Marker {
  container: Phaser.GameObjects.Container;
  arrow: Phaser.GameObjects.Image;
  x: number;
  y: number;
}

type KeyName = 'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'e' | 'space';

interface Placed {
  img: Phaser.GameObjects.Image;
  left: number;
  top: number;
  depth: number;
}

export class DataCenter extends Phaser.Scene {
  private def!: StageDef;
  private player!: Phaser.Physics.Arcade.Sprite;
  private shadow!: Phaser.GameObjects.Image;
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private facing: Facing = 'down';
  private area: AreaId | null = null;
  private near: { spot: SpotDef; kind: InteractionKind } | null = null;
  private lastSpot: SpotDef | null = null;
  private inputReadyAt = 0;
  private angry = false;
  private cleanups: (() => void)[] = [];
  private spots: { spot: SpotDef; kind: InteractionKind; area: AreaId | null }[] = [];

  private prompt!: Phaser.GameObjects.Container;
  private promptBg!: Phaser.GameObjects.Graphics;
  private promptKey!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  /** Text currently drawn in the prompt (redrawn only when it changes) */
  private promptLabel: string | null = null;

  private leds: Led[] = [];
  private blink = 0;
  private racks: RackView[] = [];
  private switchLeds: Led[] = [];
  private routerLeds!: { wan: Led; lan: Led };
  private patchLed!: Led;
  private pduLeds!: { A: Led; B: Led };
  private upsLed!: Led;
  private upsLcd!: Phaser.GameObjects.Rectangle;
  private upsLcdState: 'normal' | 'battery' | 'off' = 'normal';
  private cracFan!: Phaser.GameObjects.Image;
  private cracLed!: Led;
  private cracDisplay!: Phaser.GameObjects.Rectangle;
  private cracText!: Phaser.GameObjects.Text;
  private cracWarn!: Phaser.GameObjects.Container;
  private cracSpinning = true;
  private powerOverlay!: Phaser.GameObjects.Rectangle;
  private powerLamp!: Phaser.GameObjects.Arc;
  private monitorAlerts: Phaser.GameObjects.Rectangle[] = [];
  private alertLevel: 'none' | 'warning' | 'critical' = 'none';
  private boxes: Phaser.GameObjects.Image[] = [];
  private mentorBubble!: Phaser.GameObjects.Image;
  private markers = new Map<string, Marker>();
  private markerKey = '';

  constructor() {
    super('DataCenter');
  }

  /** Reset per-run state (a scene instance can be restarted). */
  init(): void {
    this.facing = 'down';
    this.area = null;
    this.near = null;
    this.lastSpot = null;
    this.inputReadyAt = 0;
    this.angry = false;
    this.cleanups = [];
    this.spots = [];
    this.promptLabel = null;
    this.leds = [];
    this.blink = 0;
    this.racks = [];
    this.switchLeds = [];
    this.monitorAlerts = [];
    this.alertLevel = 'none';
    this.boxes = [];
    this.markers = new Map();
    this.markerKey = '';
    this.cracSpinning = true;
  }

  create(): void {
    const run = gameStore.getState().run;
    this.def = getStage(run?.stage ?? 0);
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    const solids = this.physics.add.staticGroup();
    this.buildFloor();
    this.buildLabels();
    this.buildWalls(solids);
    this.buildEquipment(solids);
    this.buildDecor(solids);
    this.buildMentor(solids);
    this.buildPlayer();
    this.physics.add.collider(this.player, solids);
    this.buildPrompt();
    this.buildInput();
    this.buildCamera();

    this.spots = SPOTS.flatMap((spot) => {
      const kind = this.def.interactions[spot.id];
      if (!kind || (kind.kind === 'quiz' && !this.def.quiz)) return [];
      return [{ spot, kind, area: roomAt(spot.x, spot.y) }];
    });
    this.area = roomAt(PLAYER_SPAWN.x, PLAYER_SPAWN.y);

    this.time.addEvent({ delay: 400, loop: true, callback: this.onBlink, callbackScope: this });

    if (run) {
      this.refreshWorld(run.world);
      this.refreshIncidents(run);
    }
    this.cleanups.push(gameStore.subscribe((s, prev) => this.onStore(s, prev)));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanup, this);

    EventBus.emit('scene-ready', this);
  }

  private cleanup(): void {
    // Whichever of SHUTDOWN/DESTROY fired first, drop the other so a restarted scene doesn't stack listeners.
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanup, this);
    const fns = this.cleanups;
    this.cleanups = [];
    for (const fn of fns) fn();
  }

  // ---------- building the world ----------

  private buildFloor(): void {
    const rt = this.add.renderTexture(0, 0, WORLD_W, WORLD_H).setOrigin(0).setDepth(DEPTH.floor);
    rt.beginDraw();
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        let key: string;
        if (isWall(tx, ty)) {
          // In 3/4 view a wall shows its painted face when there is floor in front (below) of it.
          key = isWall(tx, ty + 1) ? 'wall-top' : `wall-face-${ty === 11 ? 1 : 0}`;
        } else {
          key = floorKey(roomAt(tx, ty), tx, ty);
        }
        rt.batchDrawFrame(key, undefined, tx * TILE, ty * TILE);
      }
    }
    for (const r of ROOMS) if (r.door) rt.batchDrawFrame('door', undefined, r.door.x * TILE, r.door.y * TILE);
    rt.endDraw();

    // wall decorations
    this.add.image(27 * TILE, 15 * TILE + 8, 'banner').setOrigin(0).setDepth(DEPTH.wallDecor);
    this.add.image(19 * TILE, 11 * TILE + 8, 'banner').setOrigin(0).setDepth(DEPTH.wallDecor);
  }

  private buildLabels(): void {
    for (const r of ROOMS) {
      if (r.id === 'corridor') continue;
      const light = r.id !== 'noc';
      this.add
        .text(Math.round(r.label.x * TILE), Math.round(r.label.y * TILE), r.name, {
          fontFamily: FONT,
          fontSize: '22px',
          color: light ? '#1f1830' : '#ffffff',
        })
        .setOrigin(0.5)
        .setAlpha(light ? 0.32 : 0.26)
        .setDepth(DEPTH.label);
      // Signs painted on the corridor floor so the player knows which door is which.
      if (r.door) {
        const top = r.door.y < 12;
        const cx = Math.round((r.door.x + r.door.w / 2) * TILE);
        const y = top ? 12 * TILE + 14 : 14 * TILE + 34;
        this.add
          .text(cx, y, `${top ? '▲' : '▼'} ${r.name}`, { fontFamily: FONT, fontSize: '13px', color: '#5a4636' })
          .setOrigin(0.5)
          .setAlpha(0.8)
          .setDepth(DEPTH.label);
      }
    }
    // Rooms this stage doesn't use are dimmed.
    if (this.def.rooms) {
      for (const r of ROOMS) {
        if (r.id === 'corridor' || this.def.rooms.includes(r.id)) continue;
        this.add
          .rectangle(r.x0 * TILE, r.y0 * TILE, (r.x1 - r.x0 + 1) * TILE, (r.y1 - r.y0 + 1) * TILE, 0x08060a, 0.5)
          .setOrigin(0)
          .setDepth(DEPTH.overlay);
      }
    }
  }

  private buildWalls(solids: Phaser.Physics.Arcade.StaticGroup): void {
    for (const r of wallRects()) {
      solids.add(this.add.zone((r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE, r.w * TILE, r.h * TILE));
    }
  }

  /** Put a texture so its bottom edge sits on the bottom of the spot's footprint (depth = that edge). */
  private place(key: string, spot: SpotDef, texH: number): Placed {
    const left = spot.x * TILE;
    const bottom = (spot.y + spot.h) * TILE;
    const top = bottom - texH;
    const img = this.add.image(left, top, key).setOrigin(0).setDepth(bottom);
    return { img, left, top, depth: bottom };
  }

  private buildEquipment(solids: Phaser.Physics.Arcade.StaticGroup): void {
    // every device footprint is solid
    for (const s of SPOTS) {
      if (s.id === 'mentor') continue;
      solids.add(this.add.zone((s.x + s.w / 2) * TILE, (s.y + s.h / 2) * TILE, s.w * TILE, s.h * TILE));
    }

    for (const { spot, rack } of RACK_SPOTS) {
      const p = this.place(`rack-${rack.slice(4)}`, SPOT_BY_ID[spot], RACK_TEX.h);
      const temp = this.add
        .text(p.left + RACK_TEX.w / 2, p.top - 2, '', {
          fontFamily: FONT,
          fontSize: '12px',
          color: '#ffb547',
          backgroundColor: '#221c28',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.overhead + 1)
        .setVisible(false);
      this.racks.push({ rack, left: p.left, top: p.top, depth: p.depth, image: p.img, sig: '', parts: [], units: [], leds: [], temp });
    }

    const sw = this.place('switch', SPOT_BY_ID.switch, CABINET_TEX.h);
    this.switchLeds = Array.from({ length: SWITCH_PORTS }, (_, i) => {
      const r = switchLed(i);
      return this.makeLed(sw.left + r.x, sw.top + r.y, r.w, r.h, sw.depth + 0.2);
    });

    const rt = this.place('router', SPOT_BY_ID.router, CABINET_TEX.h);
    const rl = (r: { x: number; y: number; w: number; h: number }) => this.makeLed(rt.left + r.x, rt.top + r.y, r.w, r.h, rt.depth + 0.2);
    this.routerLeds = { wan: rl(ROUTER_LEDS.wan), lan: rl(ROUTER_LEDS.lan) };

    const pp = this.place('patch', SPOT_BY_ID.patch, CABINET_TEX.h);
    this.patchLed = this.makeLed(pp.left + PATCH_LED.x, pp.top + PATCH_LED.y, PATCH_LED.w, PATCH_LED.h, pp.depth + 0.2);

    const pdu = this.place('pdu', SPOT_BY_ID.pdu, CABINET_TEX.h);
    const pl = (r: { x: number; y: number; w: number; h: number }) => this.makeLed(pdu.left + r.x, pdu.top + r.y, r.w, r.h, pdu.depth + 0.2);
    this.pduLeds = { A: pl(PDU_LEDS.A), B: pl(PDU_LEDS.B) };

    const ups = this.place('ups', SPOT_BY_ID.ups, CABINET_TEX.h);
    this.upsLcd = this.add
      .rectangle(ups.left + UPS_LCD.x, ups.top + UPS_LCD.y, UPS_LCD.w, UPS_LCD.h, 0x6fd38a)
      .setOrigin(0)
      .setDepth(ups.depth + 0.1);
    this.upsLed = this.makeLed(ups.left + UPS_LED.x, ups.top + UPS_LED.y, UPS_LED.w, UPS_LED.h, ups.depth + 0.2);

    const crac = this.place('crac', SPOT_BY_ID.crac, CRAC_TEX.h);
    const fx = crac.left + CRAC_TEX.fanX;
    const fy = crac.top + CRAC_TEX.fanY;
    // the blade art's centre pixel sits 1.5 px right/below the texture centre
    this.cracFan = this.add.image(fx, fy, 'crac-fan').setOrigin(34.5 / 66).setDepth(crac.depth + 0.1);
    this.add.image(fx, fy, 'crac-grille').setDepth(crac.depth + 0.2);
    const d = CRAC_TEX.display;
    this.cracDisplay = this.add.rectangle(crac.left + d.x, crac.top + d.y, d.w, d.h, 0x1d4a34).setOrigin(0).setDepth(crac.depth + 0.1);
    this.cracText = this.add
      .text(crac.left + d.x + d.w / 2, crac.top + d.y + d.h / 2, 'OK', { fontFamily: FONT, fontSize: '11px', color: '#4fd17a' })
      .setOrigin(0.5)
      .setDepth(crac.depth + 0.2);
    const l = CRAC_TEX.led;
    this.cracLed = this.makeLed(crac.left + l.x, crac.top + l.y, l.w, l.h, crac.depth + 0.2);
    const warnIcon = this.add.image(0, 0, 'warn').setScale(1.4).setOrigin(0.5, 1);
    const warnText = this.add
      .text(0, 2, '고장!', { fontFamily: FONT, fontSize: '12px', color: '#ffffff', backgroundColor: '#d7262b', padding: { x: 4, y: 2 } })
      .setOrigin(0.5, 0);
    this.cracWarn = this.add
      .container(crac.left + CRAC_TEX.w / 2, crac.top - 22, [warnIcon, warnText])
      .setDepth(DEPTH.overhead + 2)
      .setVisible(false);
    this.tweens.add({ targets: this.cracWarn, y: crac.top - 30, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const mon = this.place('monitor-wall', SPOT_BY_ID.monitor, MONITOR_TEX.h);
    this.monitorAlerts = MONITOR_SCREENS.map((r) =>
      this.add
        .rectangle(mon.left + r.x, mon.top + r.y, r.w, r.h, 0xff3b3b)
        .setOrigin(0)
        .setDepth(mon.depth + 0.1)
        .setAlpha(0),
    );

    this.place('desk', SPOT_BY_ID.desk, DESK_TEX.h);
    this.place('whiteboard', SPOT_BY_ID.board, BOARD_TEX.h);

    // Blackout: the power room goes dark and an emergency lamp pulses.
    const pr = ROOM_BY_ID.power;
    this.powerOverlay = this.add
      .rectangle(pr.x0 * TILE, (pr.y0 + 1) * TILE, (pr.x1 - pr.x0 + 1) * TILE, (pr.y1 - pr.y0) * TILE, 0x05030a, 1)
      .setOrigin(0)
      .setAlpha(0.66)
      .setDepth(DEPTH.overlay)
      .setVisible(false);
    this.powerLamp = this.add
      .circle(6.5 * TILE, 16.5 * TILE, 70, 0xff2a2a, 0.22)
      .setDepth(DEPTH.overlay + 1)
      .setVisible(false);
    this.tweens.add({ targets: this.powerLamp, alpha: 0.05, duration: 500, yoyo: true, repeat: -1 });
  }

  private buildDecor(solids: Phaser.Physics.Arcade.StaticGroup): void {
    for (const d of DECOR) {
      const x = (d.x + 0.5) * TILE;
      const y = (d.y + 1) * TILE - 2;
      this.add.image(x, y, d.tex).setOrigin(0.5, 1).setDepth(d.overhead ? DEPTH.overhead : y);
      if (d.solid) solids.add(this.add.zone(x, (d.y + 0.65) * TILE, TILE * 0.8, TILE * 0.6));
    }
    for (const t of TRAYS) {
      for (let x = t.x0; x <= t.x1; x++) {
        this.add.image(x * TILE, t.y * TILE + 4, 'tray').setOrigin(0).setDepth(DEPTH.overhead).setAlpha(0.95);
      }
    }
    // Cardboard boxes for servers that haven't been mounted yet (stage 1).
    this.boxes = UNBOXED_SPOTS.map((b) => {
      const y = (b.y + 1) * TILE - 4;
      return this.add
        .image((b.x + 0.5) * TILE, y, 'box')
        .setOrigin(0.5, 1)
        .setDepth(y)
        .setVisible(false);
    });
  }

  private buildMentor(solids: Phaser.Physics.Arcade.StaticGroup): void {
    const s = SPOT_BY_ID.mentor;
    const x = (s.x + 0.5) * TILE;
    const y = (s.y + 1) * TILE - 4;
    if (!this.anims.exists('mentor-idle')) {
      this.anims.create({
        key: 'mentor-idle',
        frames: [
          { key: 'mentor', frame: 0, duration: 900 },
          { key: 'mentor', frame: 1, duration: 650 },
        ],
        repeat: -1,
      });
    }
    this.add.image(x, y, 'shadow').setDepth(y - 1);
    this.add.sprite(x, y, 'mentor', 0).setOrigin(0.5, 1).setDepth(y).play('mentor-idle');
    this.add
      .text(x, y + 3, '쿠사수', {
        fontFamily: FONT,
        fontSize: '11px',
        color: '#f4ece4',
        backgroundColor: '#22305e',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5, 0)
      .setDepth(y + 0.5);
    this.mentorBubble = this.add
      .image(x + 24, y - 56, 'bubble-question')
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.marker - 1)
      .setVisible(false);
    this.tweens.add({ targets: this.mentorBubble, y: y - 62, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    solids.add(this.add.zone(x, (s.y + 0.6) * TILE, TILE * 0.8, TILE * 0.8));
  }

  private buildPlayer(): void {
    const x = (PLAYER_SPAWN.x + 0.5) * TILE;
    const y = (PLAYER_SPAWN.y + 0.5) * TILE + 10;
    this.shadow = this.add.image(x, y, 'shadow');
    this.player = this.physics.add.sprite(x, y, 'lion_walk', 0);
    this.player.setOrigin(0.5, LION_FEET_Y / LION_FRAME).setScale(LION_SCALE);
    // small body at the feet (frame units; Arcade scales it with the sprite)
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(40, 20, false);
    body.setOffset((LION_FRAME - 40) / 2, LION_FEET_Y - 20);
    this.player.setCollideWorldBounds(true);
    this.player.play('lion-idle');
  }

  private buildPrompt(): void {
    this.promptBg = this.add.graphics();
    this.promptKey = this.add.text(0, 0, 'E', { fontFamily: FONT, fontSize: '12px', color: '#2a1410' }).setOrigin(0.5);
    this.promptText = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#f4ece4' }).setOrigin(0, 0.5);
    this.prompt = this.add.container(0, 0, [this.promptBg, this.promptKey, this.promptText]).setDepth(DEPTH.prompt).setVisible(false);
    this.prompt.on('pointerdown', () => this.tryInteract());
  }

  private buildInput(): void {
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    // enableCapture = false: React inputs and the xterm terminal must still receive these keys.
    this.keys = kb.addKeys(
      { up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D, e: K.E, space: K.SPACE },
      false,
    ) as Record<KeyName, Phaser.Input.Keyboard.Key>;
    kb.disableGlobalCapture();
    // Use the key's down event rather than polling JustDown: a quick tap whose keydown and keyup
    // land in the same frame would otherwise be lost (Key.onUp clears the just-down flag).
    this.keys.e.on(Phaser.Input.Keyboard.Events.DOWN, this.onActionKey, this);
    this.keys.space.on(Phaser.Input.Keyboard.Events.DOWN, this.onActionKey, this);

    // While walking around (no window open), stop Space/arrows from scrolling the page or re-clicking a focused HUD button.
    const onKeyDown = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.code) || isBlocked(gameStore.getState())) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], .xterm')) return;
      e.preventDefault();
      if (t && t !== document.body) t.blur();
    };
    window.addEventListener('keydown', onKeyDown);
    this.cleanups.push(() => window.removeEventListener('keydown', onKeyDown));
  }

  private onActionKey(): void {
    // loop.now is the same clock as update(time) (loop.time is a separate accumulator)
    if (this.game.loop.now < this.inputReadyAt) return;
    this.tryInteract();
  }

  private buildCamera(): void {
    const cam = this.cameras.main;
    cam.setRoundPixels(true);
    // Zoom, bounds and offset first: startFollow snaps to the lion using the offset it is given
    // (it resets followOffset), so passing the real one avoids a slide-in pan at stage start.
    this.layoutCamera();
    cam.startFollow(this.player, true, 0.12, 0.12, cam.followOffset.x, cam.followOffset.y);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layoutCamera, this);
    this.cleanups.push(() => this.scale.off(Phaser.Scale.Events.RESIZE, this.layoutCamera, this));
  }

  private layoutCamera(): void {
    const cam = this.cameras.main;
    const { width, height } = this.scale.gameSize;
    // Never below 1: pixelArt uses NEAREST sampling, so zooming out drops pixel rows and the
    // Galmuri labels / 3 px art become unreadable (1280x720 used to get 0.75).
    const zoom = Phaser.Math.Clamp(Math.floor(Math.min(width / 1280, height / 800) * 4) / 4, 1, 2);
    cam.setZoom(zoom);
    // Phaser subtracts followOffset from the target, so a positive x puts the lion right of centre:
    // the middle of the area not covered by the objective panel on wide screens (and a bit below the HUD).
    const wide = width >= 900;
    cam.setFollowOffset(wide ? PANEL_W / 2 / zoom : 0, HUD_H / 2 / zoom);
    // Let the map's left/top edges scroll out from under the panel and HUD.
    const padL = wide ? PANEL_W / zoom : 0;
    const padT = HUD_H / zoom;
    cam.setBounds(-padL, -padT, WORLD_W + padL, WORLD_H + padT);
  }

  // ---------- live state ----------

  private onStore(s: GameState, prev: GameState): void {
    if (!this.sys.isActive()) return;
    // "Retry" on the results screen starts a fresh run of this same stage, and App keeps the game
    // mounted (key = stage). Rebuild the scene so the lion respawns in the corridor and room visits
    // count again for the new run.
    if (s.run?.stage === this.def.id && isFreshRun(s, prev)) {
      this.scene.restart();
      return;
    }
    if (s.run && s.run.world !== prev.run?.world) this.refreshWorld(s.run.world);
    if (s.run && s.run.scenarios !== prev.run?.scenarios) this.refreshIncidents(s.run);
    // A window opened/closed: drop held keys so the lion doesn't keep walking.
    if (isBlocked(s) !== isBlocked(prev)) this.input.keyboard?.resetKeys();
  }

  private makeLed(x: number, y: number, w: number, h: number, depth: number): Led {
    const rect = this.add.rectangle(x, y, w, h, LED_COLOR.off).setOrigin(0).setDepth(depth);
    const led: Led = { rect, state: 'off', phase: Math.floor(Math.random() * 3) };
    this.leds.push(led);
    return led;
  }

  private setLed(led: Led | undefined, state: LedState): void {
    if (!led) return;
    if (led.state !== state) {
      led.state = state;
      led.rect.setFillStyle(LED_COLOR[state]);
    }
    this.applyBlinkTo(led);
  }

  /** Green flickers like network activity, red flashes, amber/off stay steady. */
  private applyBlinkTo(led: Led): void {
    const t = this.blink + led.phase;
    if (led.state === 'green') led.rect.setAlpha(t % 3 === 0 ? 0.4 : 1);
    else if (led.state === 'red') led.rect.setAlpha(t % 2 === 0 ? 1 : 0.4);
    else led.rect.setAlpha(1);
  }

  private onBlink(): void {
    this.blink++;
    for (const l of this.leds) this.applyBlinkTo(l);
    const on = this.blink % 2 === 0;
    // NOC screens flash during incidents
    const color = this.alertLevel === 'critical' ? 0xff3b3b : 0xffb547;
    for (const r of this.monitorAlerts) {
      r.setFillStyle(color);
      r.setAlpha(this.alertLevel === 'none' ? 0 : on ? 0.5 : 0.18);
    }
    this.applyUpsLcd(on);
    if (this.powerOverlay.visible) this.powerOverlay.setAlpha(on ? 0.7 : 0.62);
  }

  private applyUpsLcd(on = true): void {
    if (this.upsLcdState === 'normal') this.upsLcd.setFillStyle(0x6fd38a).setAlpha(1);
    else if (this.upsLcdState === 'battery') this.upsLcd.setFillStyle(0xffb547).setAlpha(on ? 1 : 0.4);
    else this.upsLcd.setFillStyle(0x2a2a30).setAlpha(1);
  }

  private refreshWorld(w: World): void {
    for (const r of this.racks) this.refreshRack(r, w);
    switchPortLeds(w).forEach((s, i) => this.setLed(this.switchLeds[i], s));
    const rl = routerLeds(w);
    this.setLed(this.routerLeds.wan, rl.wan);
    this.setLed(this.routerLeds.lan, rl.lan);
    this.setLed(this.patchLed, patchLed(w));
    const pl = pduLeds(w);
    this.setLed(this.pduLeds.A, pl.A);
    this.setLed(this.pduLeds.B, pl.B);
    const ups = upsView(w);
    this.setLed(this.upsLed, ups.led);
    this.upsLcdState = ups.lcd;
    this.applyUpsLcd();

    const ok = cracOk(w);
    this.cracSpinning = ok;
    this.setLed(this.cracLed, ok ? 'green' : 'red');
    this.cracDisplay.setFillStyle(ok ? 0x1d4a34 : 0x5a1416);
    this.cracText.setText(ok ? 'OK' : 'ERR').setColor(ok ? '#4fd17a' : '#ff5a5f');
    this.cracWarn.setVisible(!ok);

    const dark = blackout(w);
    this.powerOverlay.setVisible(dark);
    this.powerLamp.setVisible(dark);

    const boxed = unmountedServers(w);
    this.boxes.forEach((b, i) => b.setVisible(i < boxed));
  }

  private refreshRack(r: RackView, w: World): void {
    const slots = rackSlots(w, r.rack).slice(0, RACK_TEX.slots);
    const sig = slots.map((s) => `${s.id}:${s.installed ? 1 : 0}`).join(',');
    if (sig !== r.sig) {
      r.sig = sig;
      // the "설치 전" outline has an endless tween; Phaser doesn't stop tweens of destroyed objects
      for (const p of r.parts) {
        this.tweens.killTweensOf(p);
        p.destroy();
      }
      this.leds = this.leds.filter((l) => !r.leds.includes(l));
      r.parts = [];
      r.units = [];
      r.leds = [];
      slots.forEach((s, i) => {
        const ux = r.left + RACK_TEX.slotX;
        const uy = r.top + RACK_TEX.slotY0 + i * RACK_TEX.slotH + 3;
        if (s.installed) {
          const unit = this.add.image(ux, uy, 'server-unit').setOrigin(0).setDepth(r.depth + 0.1);
          const label = this.add
            .text(ux + 5, uy + 3, s.id, { fontFamily: FONT, fontSize: '11px', color: '#e8eefc' })
            .setDepth(r.depth + 0.3);
          const led = this.makeLed(ux + RACK_TEX.ledX, uy + RACK_TEX.ledY, 6, 6, r.depth + 0.2);
          r.parts.push(unit, label, led.rect);
          r.units.push(unit);
          r.leds.push(led);
        } else {
          // Dashed-looking outline where a not-yet-mounted server goes.
          const ghost = this.add
            .rectangle(ux + 1, uy + 1, RACK_TEX.unitW - 2, RACK_TEX.unitH - 2)
            .setOrigin(0)
            .setStrokeStyle(2, 0xffb547, 0.8)
            .setDepth(r.depth + 0.1);
          const label = this.add
            .text(ux + 5, uy + 3, `${s.id} 설치 전`, { fontFamily: FONT, fontSize: '11px', color: '#ffb547' })
            .setDepth(r.depth + 0.3);
          if (label.width > RACK_TEX.unitW - 8) label.setText(s.id);
          this.tweens.add({ targets: ghost, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });
          r.parts.push(ghost, label);
        }
      });
    }
    let li = 0;
    for (const s of slots) if (s.installed) this.setLed(r.leds[li++], s.led);

    const t = rackTemp(w, r.rack);
    const hot = t !== null && t > 35;
    for (const img of [r.image, ...r.units]) {
      if (hot) img.setTint(0xff8f80);
      else img.clearTint();
    }
    if (t !== null && t >= 30) {
      r.temp
        .setText(`${Math.round(t)}°C`)
        .setColor(hot ? '#ff5a5f' : '#ffb547')
        .setVisible(true);
    } else r.temp.setVisible(false);
  }

  private refreshIncidents(run: StageRun): void {
    const active = activeScenarios(run);
    this.angry = active.some((a) => a.def.severity === 'critical');
    this.alertLevel = this.angry ? 'critical' : active.length ? 'warning' : 'none';
    this.mentorBubble.setVisible(active.length > 0);

    const key = active.map((a) => a.rt.id).join('|');
    if (key === this.markerKey) return;
    this.markerKey = key;

    const ids = new Set(active.map((a) => a.rt.id));
    for (const [id, m] of this.markers) {
      if (ids.has(id)) continue;
      // stop the endless pulse tweens too (they'd keep running on destroyed objects)
      this.tweens.killTweensOf([...m.container.list, m.arrow]);
      m.container.destroy();
      m.arrow.destroy();
      this.markers.delete(id);
    }
    const byRoom = new Map<AreaId, typeof active>();
    for (const a of active) byRoom.set(a.def.room, [...(byRoom.get(a.def.room) ?? []), a]);
    for (const [room, list] of byRoom) {
      const r = ROOM_BY_ID[room];
      list.forEach((a, i) => {
        const x = Math.round(r.label.x * TILE + (i - (list.length - 1) / 2) * 170);
        const y = Math.round(r.label.y * TILE - 42);
        let m = this.markers.get(a.rt.id);
        if (!m) {
          m = this.createMarker(a.def.title, a.def.severity);
          this.markers.set(a.rt.id, m);
        }
        m.x = x;
        m.y = y;
        m.container.setPosition(x, y);
      });
    }
  }

  private createMarker(title: string, severity: 'critical' | 'warning'): Marker {
    const bubble = this.add.image(0, 0, 'bubble-alert').setOrigin(0.5, 1).setScale(1.5);
    const critical = severity === 'critical';
    const tag = this.add
      .text(0, 4, title, {
        fontFamily: FONT,
        fontSize: '12px',
        color: critical ? '#ffffff' : '#2a1410',
        backgroundColor: critical ? '#d7262b' : '#ffb547',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5, 0);
    const container = this.add.container(0, 0, [bubble, tag]).setDepth(DEPTH.marker);
    this.tweens.add({ targets: bubble, scale: 1.8, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const arrow = this.add.image(0, 0, 'arrow').setDepth(DEPTH.arrow).setVisible(false);
    this.tweens.add({ targets: arrow, alpha: 0.45, duration: 380, yoyo: true, repeat: -1 });
    return { container, arrow, x: 0, y: 0 };
  }

  /** Off-screen incidents get an arrow at the edge of the view pointing at them. */
  private updateArrows(): void {
    if (this.markers.size === 0) return;
    const cam = this.cameras.main;
    const v = cam.worldView;
    const z = cam.zoom;
    const wide = this.scale.gameSize.width >= 900;
    const left = v.x + (wide ? PANEL_W + 24 : 24) / z;
    const right = Math.max(left, v.right - 28 / z);
    const top = v.y + (HUD_H + 24) / z;
    const bottom = Math.max(top, v.bottom - 28 / z);
    for (const m of this.markers.values()) {
      // fade a marker the lion is standing under so it doesn't hide him
      const close = Math.abs(m.x - this.player.x) < 90 && m.y - 70 < this.player.y && this.player.y < m.y + 70;
      m.container.setAlpha(close ? 0.35 : 1);
      const inside = m.x >= left && m.x <= right && m.y - 40 >= top && m.y <= bottom;
      m.arrow.setVisible(!inside);
      if (inside) continue;
      const ax = Phaser.Math.Clamp(m.x, left, right);
      const ay = Phaser.Math.Clamp(m.y, top, bottom);
      m.arrow.setPosition(ax, ay).setRotation(Math.atan2(m.y - ay, m.x - ax)).setScale(1.6 / z);
    }
  }

  // ---------- per frame ----------

  update(time: number, delta: number): void {
    const s = gameStore.getState();
    const blocked = isBlocked(s);
    if (blocked) this.inputReadyAt = time + 200;

    let vx = 0;
    let vy = 0;
    if (!blocked) {
      const k = this.keys;
      if (k.left.isDown || k.a.isDown) vx -= 1;
      if (k.right.isDown || k.d.isDown) vx += 1;
      if (k.up.isDown || k.w.isDown) vy -= 1;
      if (k.down.isDown || k.s.isDown) vy += 1;
    }
    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const len = Math.hypot(vx, vy);
      this.player.setVelocity((vx / len) * SPEED, (vy / len) * SPEED);
      this.facing = facingFor(vx, vy, this.facing);
    } else {
      this.player.setVelocity(0, 0);
    }

    // animation
    const fixing = s.fixing && !!s.modal;
    const look = lionLook({ moving, facing: this.facing, angry: this.angry, fixing });
    if ('anim' in look) {
      // a sheet that failed to load has no animation: don't warn "Missing animation" every frame
      if (this.anims.exists(look.anim)) this.player.play(look.anim, true);
    } else {
      this.player.anims.stop();
      if (this.player.texture.key !== look.texture || this.player.frame.name !== String(look.frame)) {
        this.player.setTexture(look.texture, look.frame);
      }
    }
    const spot = this.lastSpot;
    this.player.setFlipX(fixing && !!spot && (spot.x + spot.w / 2) * TILE < this.player.x);
    this.player.setDepth(this.player.y);
    this.shadow.setPosition(this.player.x, this.player.y - 1).setDepth(this.player.y - 1);

    // rooms
    const area = roomAt(Math.floor(this.player.x / TILE), Math.floor(this.player.y / TILE));
    if (area && area !== this.area) {
      this.area = area;
      if (area !== 'corridor') {
        s.enterRoom(area);
        EventBus.emit('room', area);
      }
    }

    // interaction prompt
    this.near = blocked ? null : this.findSpot();
    this.updatePrompt(time);

    if (this.cracSpinning) this.cracFan.rotation += delta * 0.012;
    this.updateArrows();
  }

  private tryInteract(): void {
    const s = gameStore.getState();
    if (!this.near || isBlocked(s)) return;
    this.lastSpot = this.near.spot;
    s.interact(this.near.spot.id);
    EventBus.emit('interact', this.near.spot.id);
  }

  private findSpot(): { spot: SpotDef; kind: InteractionKind } | null {
    const px = this.player.x;
    const py = this.player.y - 6;
    let best: { spot: SpotDef; kind: InteractionKind } | null = null;
    let bestD = INTERACT_RANGE;
    for (const c of this.spots) {
      // never through a wall: the device must be in the same room as the lion
      if (c.area !== this.area) continue;
      const x0 = c.spot.x * TILE;
      const y0 = c.spot.y * TILE;
      const dx = Math.max(x0 - px, 0, px - (x0 + c.spot.w * TILE));
      const dy = Math.max(y0 - py, 0, py - (y0 + c.spot.h * TILE));
      const d = Math.hypot(dx, dy);
      if (d <= bestD) {
        bestD = d;
        best = { spot: c.spot, kind: c.kind };
      }
    }
    return best;
  }

  private updatePrompt(time: number): void {
    const near = this.near;
    if (!near) {
      this.prompt.setVisible(false);
      return;
    }
    const { spot, kind } = near;
    // the verb can change while standing still (CRAC breaks → "점검하기" becomes "수리하기")
    const label = `${spot.label} · ${verbFor(kind, this.cracSpinning)}`;
    if (this.promptLabel !== label) {
      this.promptLabel = label;
      this.drawPrompt(label);
    }
    const x = Math.round((spot.x + spot.w / 2) * TILE);
    // keep clear of the CRAC's "고장!" sign and a hot rack's °C tag when they are up
    let lift = 0;
    if (spot.id === 'crac' && this.cracWarn.visible) lift = 44;
    else if (this.racks.some((r) => r.rack === spot.id && r.temp.visible)) lift = 22;
    const y = Math.round(spot.y * TILE - (OVERHANG[spot.id] ?? 24) - lift - 4 + Math.sin(time / 260) * 2);
    this.prompt.setPosition(x, y).setVisible(true);
  }

  private drawPrompt(label: string): void {
    this.promptText.setText(label);
    const keyW = 18;
    const gap = 7;
    const padX = 8;
    const h = Math.max(Math.ceil(this.promptText.height), 16) + 10;
    const w = Math.ceil(padX + keyW + gap + this.promptText.width + padX);
    const top = -h - 7;
    const g = this.promptBg;
    g.clear();
    g.fillStyle(0x2a1410, 1);
    g.fillRoundedRect(-w / 2 - 2, top - 2, w + 4, h + 4, 7);
    g.fillTriangle(-7, -8, 7, -8, 0, 0);
    g.fillStyle(0x221c28, 0.97);
    g.fillRoundedRect(-w / 2, top, w, h, 6);
    g.fillTriangle(-4, -9, 4, -9, 0, -3);
    g.fillStyle(0xd7262b, 1);
    g.fillRect(-w / 2 + 6, top, w - 12, 2);
    // key cap
    const kx = Math.round(-w / 2 + padX);
    const ky = Math.round(top + (h - 18) / 2);
    g.fillStyle(0xc48e57, 1);
    g.fillRoundedRect(kx, ky, keyW, 18, 4);
    g.fillStyle(0xe9b77c, 1);
    g.fillRoundedRect(kx, ky, keyW, 15, 4);
    this.promptKey.setPosition(kx + keyW / 2, ky + 8);
    this.promptText.setPosition(kx + keyW + gap, Math.round(top + h / 2));
    // clicking the prompt works too
    const area = new Phaser.Geom.Rectangle(-w / 2, top, w, h);
    if (this.prompt.input) this.prompt.input.hitArea = area;
    else this.prompt.setInteractive({ hitArea: area, hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
  }
}
