// Web Audio engine: one AudioContext, gain buses (limiter ← master ← duck ← music, sfx, voice), decoded clips,
// looping music with crossfades, one-shot effects and the dialogue blips.
// Everything fails silently: no context, a blocked context or a file that won't load just means no sound.
import { AUDIO_PREF_KEY, BLIP_SECONDS, letterOffset, parseAudioPref, trimSilence, type MusicTrack, type Span } from './logic';

const FILES = {
  normal: 'bgm_normal.m4a',
  incident: 'bgm_incident.m4a',
  alarm: 'sfx_alarm.m4a',
  win: 'sfx_win.m4a',
  voice: 'voice_animalese.wav',
} as const;
type ClipId = keyof typeof FILES;
export type SfxId = 'alarm' | 'win';

/** Mix levels (the incident loop is mastered ~8 dB louder than the normal one). */
const BUS = { music: 0.4, sfx: 0.7, voice: 0.35 };
const TRACK_GAIN: Record<MusicTrack, number> = { normal: 1, incident: 0.42 };
const SFX_GAIN: Record<SfxId, number> = { alarm: 0.8, win: 1.3 };
/** Music level while the win jingle plays */
const DUCK = 0.35;
/** Crossfade between the two music loops (seconds) */
const FADE = 0.6;
/** Music that picks up where it left off (the incident loop always starts from the top) */
const RESUME: Record<MusicTrack, boolean> = { normal: true, incident: false };

interface Clip {
  buffer: AudioBuffer;
  /** Sound without the near-silent ends (loop points for music) */
  span: Span;
}

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

interface Playing extends Voice {
  track: MusicTrack;
  /** ctx time when it started, and the loop position it started from */
  startedAt: number;
  from: number;
}

type Ctor = typeof AudioContext;

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
  private current: Playing | null = null;
  private resumeAt: Record<MusicTrack, number> = { normal: 0, incident: 0 };
  private alarm: (Voice & { endsAt: number }) | null = null;
  private blipping: (Voice & { endsAt: number }) | null = null;

  private muted = false;
  private listeners = new Set<() => void>();
  /** Counts for the dev hook / e2e checks */
  private stats = { alarm: 0, win: 0, blip: 0 };

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
    for (const type of ['pointerdown', 'keydown', 'click', 'touchend'] as const) window.addEventListener(type, this.onGesture, true);
    document.addEventListener('visibilitychange', this.onVisibility);
    // Download now (no audio context needed yet) so sound is ready right after the first click. Small files first.
    for (const id of ['voice', 'alarm', 'win', 'normal', 'incident'] as ClipId[]) this.fetchRaw(id);
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
    if (!ctx || this.current?.track === this.want) return;
    // The wanted loop is still loading (or won't load): keep the current one rather than go silent.
    if (this.want && !this.clips.has(this.want) && this.current) return;
    if (this.current) {
      this.fadeOut(this.current, ctx);
      this.current = null;
    }
    if (this.want) this.startTrack(this.want, ctx);
  }

  private startTrack(track: MusicTrack, ctx: AudioContext): void {
    const clip = this.clips.get(track);
    if (!clip || !this.musicBus) return;
    const { start, end } = clip.span;
    const loopLen = end - start;
    if (loopLen <= 0.1) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      src.loop = true;
      src.loopStart = start;
      src.loopEnd = end;
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(TRACK_GAIN[track], now + FADE);
      src.connect(gain);
      gain.connect(this.musicBus);
      const from = RESUME[track] ? this.resumeAt[track] % loopLen : 0;
      src.start(now, start + from);
      src.onended = () => quietly(() => gain.disconnect());
      this.current = { track, src, gain, startedAt: now, from };
    } catch {
      this.current = null;
    }
  }

  private fadeOut(p: Playing, ctx: AudioContext): void {
    const clip = this.clips.get(p.track);
    if (clip && RESUME[p.track]) {
      const loopLen = clip.span.end - clip.span.start;
      // where it will be once the fade ends
      this.resumeAt[p.track] = (p.from + ctx.currentTime - p.startedAt + FADE) % loopLen;
    }
    stopSource(p, ctx, FADE);
  }

  // ---------- effects ----------

  playSfx(id: SfxId): void {
    const ctx = this.ctx;
    const clip = this.clips.get(id);
    if (!ctx || !clip || !this.sfxBus || !this.live(ctx)) return;
    const { start, end } = clip.span;
    try {
      if (id === 'alarm') this.stopAlarm(); // never two beeps at once
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      const gain = ctx.createGain();
      gain.gain.value = SFX_GAIN[id];
      src.connect(gain);
      gain.connect(this.sfxBus);
      const now = ctx.currentTime;
      src.start(now, start, end - start);
      src.onended = () => {
        quietly(() => gain.disconnect());
        if (this.alarm?.src === src) this.alarm = null;
      };
      if (id === 'alarm') this.alarm = { src, gain, endsAt: now + end - start };
      else this.duckMusic(end - start);
      this.stats[id]++;
    } catch {
      /* ignore */
    }
  }

  stopAlarm(): void {
    const a = this.alarm;
    this.alarm = null;
    if (a && this.ctx && this.ctx.currentTime < a.endsAt) stopSource(a, this.ctx, 0.03);
  }

  /** Lower the music for `seconds`, then bring it back. */
  private duckMusic(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.duck) return;
    const g = this.duck.gain;
    const now = ctx.currentTime;
    quietly(() => {
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(DUCK, now + 0.12);
      g.setValueAtTime(DUCK, now + Math.max(0.12, seconds - 0.3));
      g.linearRampToValueAtTime(1, now + seconds + 0.5);
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
            : id === 'normal' || id === 'incident'
              ? trimSilence(channels, buffer.sampleRate, { threshold: 1e-3, maxTrim: 0.25 }) // encoder padding only
              : trimSilence(channels, buffer.sampleRate, { threshold: 1e-3 });
        this.clips.set(id, { buffer, span });
      }
      if (id === 'normal' || id === 'incident') this.applyMusic();
    } catch {
      this.failed.add(id);
    }
  }

  /** What the engine is doing (dev hook for e2e checks). */
  debugState() {
    return {
      context: this.ctx?.state ?? 'none',
      music: this.current?.track ?? null,
      want: this.want,
      muted: this.muted,
      loaded: [...this.clips.keys()],
      failed: [...this.failed],
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
