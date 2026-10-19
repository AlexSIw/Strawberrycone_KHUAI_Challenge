// Web Audio engine: one AudioContext, gain buses (limiter ← master ← duck ← music, sfx, voice), decoded clips,
// looping music with equal-power crossfades, one-shot effects and the dialogue blips.
// Everything fails silently: no context, a blocked context or a file that won't load just means no sound.
import {
  AUDIO_PREF_KEY,
  BLIP_SECONDS,
  crossfade,
  envelopeAt,
  envelopePoints,
  letterOffset,
  loudnessGains,
  parseAudioPref,
  RESUME,
  trimSilence,
  type Crossfade,
  type Envelope,
  type MusicTrack,
  type Span,
} from './logic';

const FILES = {
  lobby: 'bgm_lobby.m4a',
  normal: 'bgm_normal.m4a',
  incident: 'bgm_incident.m4a',
  alarm: 'sfx_alarm.m4a',
  win: 'sfx_win.m4a',
  coin: 'sfx_coin.m4a',
  voice: 'voice_animalese.wav',
} as const;
type ClipId = keyof typeof FILES;
export type SfxId = 'alarm' | 'win' | 'coin';

const MUSIC: readonly ClipId[] = ['lobby', 'normal', 'incident'];
const isMusic = (id: ClipId): id is MusicTrack => MUSIC.includes(id);

/** Mix levels */
const BUS = { music: 0.4, sfx: 0.7, voice: 0.35 };
/** Per-track gains that make the three loops equally loud (measured loudness, see logic.ts). */
const TRACK_GAIN: Record<MusicTrack, number> = loudnessGains();
const SFX_GAIN: Record<SfxId, number> = { alarm: 0.8, win: 1.3, coin: 0.9 };
/** Music level while the win jingle plays */
const DUCK = 0.35;
/** Shortest fade-out of a music loop (seconds): even a "cut" ramps down, so it never clicks */
const MIN_FADE = 0.05;
/** Every effect fades out over its last few ms (at most this long): the coin is cut off mid-decay and would end in a click. */
const SFX_TAIL = 0.04;
/** A win jingle still sounding when the next one starts makes way this fast (seconds): one jingle at a time. */
const JINGLE_CUT = 0.08;

interface Clip {
  buffer: AudioBuffer;
  /** Sound without the near-silent ends (loop points for music) */
  span: Span;
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/** One effect played (dev hook history); `cutAt`: when a later jingle made it fade out early. */
interface SfxEntry {
  id: SfxId;
  at: number;
  cutAt?: number;
}

/** A one-shot effect that is sounding or scheduled. */
interface SfxVoice extends Voice {
  endsAt: number;
  entry: SfxEntry;
}

/** One playing music loop. A track being faded out stays here until it is silent. */
interface MusicVoice extends Voice {
  track: MusicTrack;
  /** ctx time it started, the loop position it started from, and the loop's length (seconds) */
  startedAt: number;
  from: number;
  loopLen: number;
  /** Its gain automation (equal-power fade), to know the gain at any moment */
  env: Envelope;
  /** On its way out: stopped once silent, unless the same track is wanted back first */
  leaving: boolean;
  stopTimer: number | null;
}

type Ctor = typeof AudioContext;

/** Input that may unlock audio (the first one creates the AudioContext). */
const GESTURES = ['pointerdown', 'keydown', 'click', 'touchend'] as const;

const noop = () => {};
/** Run something that may throw or return a promise that may reject, and ignore both. */
function quietly(fn: () => unknown): void {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).then(noop, noop);
  } catch {
    /* ignore */
  }
}

function stopSource(v: Voice, ctx: AudioContext, fade: number): void {
  const now = ctx.currentTime;
  const g = v.gain.gain;
  quietly(() => {
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
  });
  quietly(() => v.src.stop(now + fade + 0.01));
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duck: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private started = false;
  private unsupported = false;

  private raw = new Map<ClipId, Promise<ArrayBuffer | null>>();
  private clips = new Map<ClipId, Clip>();
  private failed = new Set<ClipId>();

  private want: MusicTrack | null = null;
  /** Every music loop that is sounding (the wanted one, and ones fading out) */
  private voices: MusicVoice[] = [];
  /** The wanted track's voice */
  private current: MusicVoice | null = null;
  /** Where each resuming track was when it started fading out (seconds into its loop) */
  private resumeAt: Record<MusicTrack, number> = { lobby: 0, normal: 0, incident: 0 };
  private alarm: SfxVoice | null = null;
  /** The win jingle sounding (or about to start) */
  private jingle: SfxVoice | null = null;
  private blipping: (Voice & { endsAt: number }) | null = null;

  private muted = false;
  private listeners = new Set<() => void>();
  /** Counts and recent history for the dev hook / e2e checks */
  private stats = { alarm: 0, win: 0, coin: 0, blip: 0 };
  private fades: (Crossfade & { from: MusicTrack | null; to: MusicTrack | null; at: number })[] = [];
  private sfxLog: SfxEntry[] = [];

  constructor() {
    try {
      this.muted = parseAudioPref(localStorage.getItem(AUDIO_PREF_KEY)).muted;
    } catch {
      /* storage blocked: sound stays on */
    }
  }

  /** Hook up the unlock-on-first-gesture and tab-visibility listeners and start downloading. Safe to call twice. */
  init(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    for (const type of GESTURES) window.addEventListener(type, this.onGesture, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    // Download now (no audio context needed yet) so sound is ready right after the first click.
    // Small files first, then the lobby tune (the title screen's), then the in-stage loops.
    for (const id of ['voice', 'alarm', 'coin', 'win', 'lobby', 'normal', 'incident'] as ClipId[]) this.fetchRaw(id);
  }

  // ---------- settings ----------

  isMuted = (): boolean => this.muted;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    try {
      localStorage.setItem(AUDIO_PREF_KEY, JSON.stringify({ muted }));
    } catch {
      /* not saved, still applied */
    }
    if (muted) {
      this.stopBlip();
      this.stopAlarm();
    }
    this.applyMaster();
    this.listeners.forEach((fn) => fn());
  }

  toggleMuted(): void {
    this.setMuted(!this.muted);
  }

  // ---------- music ----------

  /** Which loop should be playing; crossfades when it changes. */
  setMusic(track: MusicTrack | null): void {
    this.want = track;
    this.applyMusic();
  }

  private applyMusic(): void {
    const ctx = this.ctx;
    const want = this.want;
    const playing = this.current?.track ?? null;
    if (!ctx || !this.musicBus || playing === want) return;
    // The wanted loop is still loading (or won't load): keep the current one rather than go silent.
    if (want && !this.clips.has(want)) return;
    const fade = crossfade(playing, want);
    const now = ctx.currentTime;
    // A resuming track that is still fading out comes back from where it is (never two copies of it).
    const back = want && RESUME[want] ? (this.voices.find((v) => v.track === want) ?? null) : null;
    for (const v of this.voices) if (v !== back) this.leave(v, fade.fadeOut, now);
    let next: MusicVoice | null = null;
    if (back) {
      back.leaving = false;
      if (back.stopTimer !== null) window.clearTimeout(back.stopTimer);
      back.stopTimer = null;
      this.ramp(back, TRACK_GAIN[back.track], fade.fadeIn, now);
      next = back;
    } else if (want) {
      next = this.startVoice(want, fade.fadeIn, ctx);
    }
    this.current = next;
    if (!want || next) this.fades = [...this.fades.slice(-9), { from: playing, to: want, ...fade, at: round3(now) }];
  }

  private startVoice(track: MusicTrack, fadeIn: number, ctx: AudioContext): MusicVoice | null {
    const clip = this.clips.get(track);
    if (!clip || !this.musicBus) return null;
    const { start, end } = clip.span;
    const loopLen = end - start;
    if (loopLen <= 0.1) return null;
    try {
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      src.loop = true;
      src.loopStart = start;
      src.loopEnd = end;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(this.musicBus);
      const now = ctx.currentTime;
      const from = RESUME[track] ? this.resumeAt[track] % loopLen : 0;
      src.start(now, start + from);
      const v: MusicVoice = { track, src, gain, startedAt: now, from, loopLen, env: { from: 0, to: 0, full: TRACK_GAIN[track], start: now, duration: 0 }, leaving: false, stopTimer: null };
      src.onended = () => {
        quietly(() => gain.disconnect());
        this.voices = this.voices.filter((x) => x !== v);
      };
      this.voices.push(v);
      // Starts from silence at a loop position: no click.
      this.ramp(v, TRACK_GAIN[track], fadeIn, now);
      return v;
    } catch {
      return null;
    }
  }

  /** Where in its loop a voice is at ctx time `t` (seconds). */
  private position(v: MusicVoice, t: number): number {
    return (v.from + Math.max(0, t - v.startedAt)) % v.loopLen;
  }

  /** Fade a voice out over `seconds` (sooner if it was already going faster), then stop it. */
  private leave(v: MusicVoice, fadeOut: number, now: number): void {
    const seconds = Math.max(MIN_FADE, fadeOut);
    if (v.leaving && v.env.start + v.env.duration <= now + seconds) return;
    // A resuming track picks up later from where it was when it began to fade.
    if (!v.leaving && RESUME[v.track]) this.resumeAt[v.track] = this.position(v, now);
    v.leaving = true;
    this.ramp(v, 0, seconds, now);
    this.stopWhenSilent(v);
  }

  /** Equal-power gain change from wherever the voice's gain is now. */
  private ramp(v: MusicVoice, to: number, seconds: number, now: number): void {
    const value = envelopeAt(v.env, now);
    v.env = { from: value, to, full: TRACK_GAIN[v.track], start: now, duration: Math.max(0, seconds) };
    const g = v.gain.gain;
    quietly(() => {
      g.cancelScheduledValues(now);
      g.setValueAtTime(seconds > 0 ? value : to, now);
      for (const p of envelopePoints(v.env)) g.linearRampToValueAtTime(p.v, p.t);
    });
  }

  /**
   * Stop a leaving voice once its fade is over. A timer rather than src.stop(when): a stop can't be taken
   * back in every browser, and the track may be wanted again mid-fade.
   */
  private stopWhenSilent(v: MusicVoice): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (v.stopTimer !== null) window.clearTimeout(v.stopTimer);
    const endsAt = v.env.start + v.env.duration;
    v.stopTimer = window.setTimeout(
      () => {
        v.stopTimer = null;
        if (!v.leaving) return;
        // The context was paused (hidden tab): the fade isn't over yet.
        if (ctx.currentTime < endsAt) return this.stopWhenSilent(v);
        quietly(() => v.src.stop());
        quietly(() => v.gain.disconnect());
        this.voices = this.voices.filter((x) => x !== v);
      },
      Math.max(0, endsAt - ctx.currentTime) * 1000 + 60,
    );
  }

  // ---------- effects ----------

  /** Play an effect now, or `delay` seconds from now. */
  playSfx(id: SfxId, delay = 0): void {
    const ctx = this.ctx;
    const clip = this.clips.get(id);
    if (!ctx || !clip || !this.sfxBus || !this.live(ctx)) return;
    const { start, end } = clip.span;
    const length = end - start;
    try {
      if (id === 'alarm') this.stopAlarm(); // never two beeps at once
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      const gain = ctx.createGain();
      const level = SFX_GAIN[id];
      gain.gain.value = level;
      src.connect(gain);
      gain.connect(this.sfxBus);
      const at = ctx.currentTime + Math.max(0, delay);
      // Full level, then down to silence over the last few ms instead of stopping on a non-zero sample.
      const tail = Math.min(SFX_TAIL, length / 4);
      gain.gain.setValueAtTime(level, at);
      gain.gain.setValueAtTime(level, at + length - tail);
      gain.gain.linearRampToValueAtTime(0, at + length);
      src.start(at, start, length);
      const entry: SfxEntry = { id, at: round3(at) };
      const voice: SfxVoice = { src, gain, endsAt: at + length, entry };
      src.onended = () => {
        quietly(() => gain.disconnect());
        if (this.alarm?.src === src) this.alarm = null;
        if (this.jingle?.src === src) this.jingle = null;
      };
      if (id === 'alarm') this.alarm = voice;
      if (id === 'win') {
        // A jingle still going (the clear popup's, when the certificate follows quickly) makes way for this one.
        if (this.jingle) this.cutSfx(this.jingle, at);
        this.jingle = voice;
        this.duckMusic(length, at);
      }
      this.stats[id]++;
      this.sfxLog = [...this.sfxLog.slice(-19), entry];
    } catch {
      /* ignore */
    }
  }

  /** Fade an effect out quickly from ctx time `at` and stop it (nothing to do if it is over by then). */
  private cutSfx(v: SfxVoice, at: number): void {
    if (at + JINGLE_CUT >= v.endsAt - SFX_TAIL) return;
    const g = v.gain.gain;
    quietly(() => {
      g.cancelScheduledValues(at);
      g.setValueAtTime(SFX_GAIN[v.entry.id], at);
      g.linearRampToValueAtTime(0, at + JINGLE_CUT);
    });
    quietly(() => v.src.stop(at + JINGLE_CUT + 0.01));
    v.endsAt = at + JINGLE_CUT;
    v.entry.cutAt = round3(at);
  }

  stopAlarm(): void {
    const a = this.alarm;
    this.alarm = null;
    if (a && this.ctx && this.ctx.currentTime < a.endsAt) stopSource(a, this.ctx, 0.03);
  }

  /** Lower the music for `seconds` from ctx time `at`, then bring it back. */
  private duckMusic(seconds: number, at: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.duck) return;
    const g = this.duck.gain;
    const now = ctx.currentTime;
    const t = Math.max(now, at);
    quietly(() => {
      const value = g.value;
      g.cancelScheduledValues(now);
      g.setValueAtTime(value, now);
      if (t > now) g.setValueAtTime(value, t);
      g.linearRampToValueAtTime(DUCK, t + 0.12);
      g.setValueAtTime(DUCK, t + Math.max(0.12, seconds - 0.3));
      g.linearRampToValueAtTime(1, t + seconds + 0.5);
    });
  }

  // ---------- dialogue blips ----------

  /**
   * One animalese blip: 0.075 s of the letter's sample at playback rate `pitch`.
   * Text types faster than one blip lasts, so a letter that arrives while a blip is still sounding is
   * skipped: every blip plays out in full (a babble every 2–3 letters) instead of being cut into clicks.
   */
  blip(letter: string, pitch: number): void {
    const ctx = this.ctx;
    const clip = this.clips.get('voice');
    if (!ctx || !clip || !this.voiceBus || !this.live(ctx)) return;
    if (this.blipping && ctx.currentTime < this.blipping.endsAt - 0.005) return;
    this.stopBlip();
    try {
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      src.playbackRate.value = pitch;
      const gain = ctx.createGain();
      const g = gain.gain;
      const now = ctx.currentTime;
      const end = now + BLIP_SECONDS;
      // Tiny fades so the 8-bit samples don't click.
      g.setValueAtTime(0, now);
      g.linearRampToValueAtTime(1, now + 0.003);
      g.setValueAtTime(1, end - 0.01);
      g.linearRampToValueAtTime(0, end);
      src.connect(gain);
      gain.connect(this.voiceBus);
      src.start(now, letterOffset(letter));
      src.stop(end + 0.005);
      const v = { src, gain, endsAt: end };
      src.onended = () => {
        quietly(() => gain.disconnect());
        if (this.blipping === v) this.blipping = null;
      };
      this.blipping = v;
      this.stats.blip++;
    } catch {
      /* ignore */
    }
  }

  stopBlip(): void {
    const b = this.blipping;
    this.blipping = null;
    if (b && this.ctx && this.ctx.currentTime < b.endsAt) stopSource(b, this.ctx, 0.006);
  }

  // ---------- context ----------

  /** Effects only play while the context runs, the tab is visible and sound is on (nothing queues up). */
  private live(ctx: AudioContext): boolean {
    return ctx.state === 'running' && !document.hidden && !this.muted;
  }

  private onGesture = (): void => {
    if (document.hidden || this.unsupported) return;
    // Only a real activation (not Shift, Esc…) may start audio; trying earlier just logs a browser warning.
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (activation && !activation.isActive) return;
    if (!this.ctx) this.create();
    const ctx = this.ctx;
    if (ctx && ctx.state !== 'running') quietly(() => ctx.resume());
  };

  private onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.hidden) {
      this.stopBlip();
      this.stopAlarm();
      quietly(() => ctx.suspend());
    } else {
      quietly(() => ctx.resume());
    }
  };

  private create(): void {
    const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    const C = w.AudioContext ?? w.webkitAudioContext;
    if (!C) {
      this.unsupported = true;
      return;
    }
    try {
      const ctx = new C({ latencyHint: 'interactive' });
      const gain = (value: number, to: AudioNode) => {
        const g = ctx.createGain();
        g.gain.value = value;
        g.connect(to);
        return g;
      };
      // A gentle limiter so an alarm, a jingle and a blip on top of the music never clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -4;
      limiter.knee.value = 4;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.2;
      limiter.connect(ctx.destination);
      this.master = gain(this.muted ? 0 : 1, limiter);
      this.duck = gain(1, this.master);
      this.musicBus = gain(BUS.music, this.duck);
      this.sfxBus = gain(BUS.sfx, this.master);
      this.voiceBus = gain(BUS.voice, this.master);
      this.ctx = ctx;
    } catch {
      this.unsupported = true;
      return;
    }
    for (const id of Object.keys(FILES) as ClipId[]) void this.load(id);
    this.applyMusic();
  }

  private applyMaster(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const g = this.master.gain;
    const now = ctx.currentTime;
    quietly(() => {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(this.muted ? 0 : 1, now + 0.05);
    });
  }

  // ---------- loading ----------

  private fetchRaw(id: ClipId): Promise<ArrayBuffer | null> {
    let p = this.raw.get(id);
    if (!p) {
      const url = `${import.meta.env.BASE_URL}assets/audio/${FILES[id]}`;
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
      this.raw.set(id, p);
    }
    return p;
  }

  private async load(id: ClipId): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const data = await this.fetchRaw(id);
      const buffer = data ? await decode(ctx, data) : null;
      if (!buffer) {
        this.failed.add(id);
      } else {
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        const span: Span =
          id === 'voice'
            ? { start: 0, end: buffer.duration } // letter offsets must stay put
            : isMusic(id)
              ? trimSilence(channels, buffer.sampleRate, { threshold: 1e-3, maxTrim: 0.25 }) // encoder padding only
              : trimSilence(channels, buffer.sampleRate, { threshold: 1e-3 });
        this.clips.set(id, { buffer, span });
      }
      if (isMusic(id)) this.applyMusic();
    } catch {
      this.failed.add(id);
    }
  }

  /** What the engine is doing (dev hook for e2e checks). Times are AudioContext seconds. */
  debugState() {
    const now = this.ctx?.currentTime ?? 0;
    return {
      context: this.ctx?.state ?? 'none',
      time: round3(now),
      music: this.current?.track ?? null,
      want: this.want,
      muted: this.muted,
      loaded: [...this.clips.keys()],
      failed: [...this.failed],
      gains: { ...TRACK_GAIN },
      duck: round3(this.duck?.gain.value ?? 1),
      voices: this.voices.map((v) => ({ track: v.track, gain: round3(envelopeAt(v.env, now)), leaving: v.leaving, pos: round3(this.position(v, now)) })),
      fades: [...this.fades],
      sfx: this.sfxLog.map((e) => ({ ...e })),
      ...this.stats,
    };
  }
}

/** decodeAudioData with both the promise and the callback form (older Safari), never rejecting. */
function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer | null> {
  return new Promise((resolve) => {
    try {
      const p = ctx.decodeAudioData(data, resolve, () => resolve(null)) as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(resolve, () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

export const audio = new AudioEngine();

if (import.meta.env.DEV && typeof window !== 'undefined') (window as Window & { __khuAudio?: AudioEngine }).__khuAudio = audio;
// Dev: the engine owns the page's one AudioContext and the director holds on to it, so swapping it in
// place would leave two engines (one still playing, one wired to the buttons). Reload the page instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
