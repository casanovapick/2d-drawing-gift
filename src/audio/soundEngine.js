const AUDIO_PREFS_KEY = 'kawaii_gachapon_audio_v1';

// Cheerful Kawaii Party melody in F Major (frequencies in Hz, 0 = rest)
const MELODY_NOTES = [
  523.25, 659.25, 783.99, 659.25, // C5 E5 G5 E5
  698.46, 880.00, 698.46, 0,      // F5 A5 F5 -
  587.33, 698.46, 880.00, 783.99, // D5 F5 A5 G5
  659.25, 523.25, 587.33, 0,      // E5 C5 D5 -
  523.25, 659.25, 783.99, 1046.5, // C5 E5 G5 C6
  880.00, 783.99, 698.46, 659.25, // A5 G5 F5 E5
  587.33, 659.25, 698.46, 783.99, // D5 E5 F5 G5
  698.46, 0,      523.25, 0,      // F5 -  C5 -
];

const BASS_NOTES = [
  174.61, 0, 261.63, 0, // F3 C4
  220.00, 0, 174.61, 0, // A3 F3
  196.00, 0, 293.66, 0, // G3 D4
  261.63, 0, 196.00, 0, // C4 G3
  174.61, 0, 261.63, 0, // F3 C4
  220.00, 0, 293.66, 0, // A3 D4
  196.00, 0, 261.63, 0, // G3 C4
  174.61, 0, 174.61, 0, // F3 F3
];

const PENTATONIC_DROPS = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.bgmTimer = null;
    this.bgmStep = 0;
    this.nextNoteTime = 0;
    this.lastDropSfxTime = 0;
    this.voiceDucked = false;

    const saved = this.loadPrefs();
    this.sfxEnabled = saved.sfxEnabled;
    this.bgmEnabled = saved.bgmEnabled;
  }

  loadPrefs() {
    try {
      const raw = localStorage.getItem(AUDIO_PREFS_KEY);
      if (!raw) return { sfxEnabled: true, bgmEnabled: true };
      const parsed = JSON.parse(raw);
      return {
        sfxEnabled: parsed.sfxEnabled !== false,
        bgmEnabled: parsed.bgmEnabled !== false,
      };
    } catch {
      return { sfxEnabled: true, bgmEnabled: true };
    }
  }

  savePrefs() {
    try {
      localStorage.setItem(
        AUDIO_PREFS_KEY,
        JSON.stringify({ sfxEnabled: this.sfxEnabled, bgmEnabled: this.bgmEnabled })
      );
    } catch {
      // Ignore
    }
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
      this.ctx.resume().catch(() => {});
    }
    if (this.bgmEnabled && !this.bgmTimer) {
      this.startBgmLoop();
    }
    return this.ctx;
  }

  unlockIOSAudio() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      // Play a 1-frame silent buffer inside user gesture to unlock iOS Safari WebKit audio
      const silentBuf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = silentBuf;
      src.connect(ctx.destination);
      src.start(0);
      if (ctx.state !== 'running') {
        ctx.resume().catch(() => {});
      }
    } catch {
      // Ignore
    }
  }

  toggleSfx() {
    this.sfxEnabled = !this.sfxEnabled;
    this.savePrefs();
    if (this.sfxEnabled) {
      this.ensureContext();
      this.playButtonTap();
    }
    return this.sfxEnabled;
  }

  toggleBgm() {
    this.bgmEnabled = !this.bgmEnabled;
    this.savePrefs();
    this.ensureContext();
    if (this.bgmEnabled) {
      this.startBgmLoop();
    } else {
      this.stopBgmLoop();
    }
    return this.bgmEnabled;
  }

  startBgmLoop() {
    if (this.bgmTimer || !this.bgmEnabled) return;
    const ctx = this.ctx;
    if (!ctx) return;

    this.nextNoteTime = ctx.currentTime + 0.08;
    const stepDuration = 0.24; // ~125 BPM eighth notes

    this.bgmTimer = window.setInterval(() => {
      if (!this.bgmEnabled || !this.ctx || this.ctx.state !== 'running') return;
      while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
        this.scheduleBgmStep(this.bgmStep, this.nextNoteTime, stepDuration);
        this.nextNoteTime += stepDuration;
        this.bgmStep = (this.bgmStep + 1) % MELODY_NOTES.length;
      }
    }, 80);
  }

  stopBgmLoop() {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  setVoiceDucking(isDucked) {
    this.voiceDucked = Boolean(isDucked);
  }

  scheduleBgmStep(step, time, dur) {
    const ctx = this.ctx;
    const melFreq = MELODY_NOTES[step];
    const bassFreq = BASS_NOTES[step];
    const duckMul = this.voiceDucked ? 0.3 : 1.0;

    if (melFreq > 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(melFreq, time);

      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.038 * duckMul, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, time + dur * 0.92);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + dur);
    }

    if (bassFreq > 0) {
      const bOsc = ctx.createOscillator();
      const bGain = ctx.createGain();
      bOsc.type = 'sine';
      bOsc.frequency.setValueAtTime(bassFreq, time);

      bGain.gain.setValueAtTime(0.0001, time);
      bGain.gain.linearRampToValueAtTime(0.042 * duckMul, time + 0.025);
      bGain.gain.exponentialRampToValueAtTime(0.001, time + dur * 1.4);

      bOsc.connect(bGain);
      bGain.connect(ctx.destination);
      bOsc.start(time);
      bOsc.stop(time + dur * 1.45);
    }
  }

  playTone({ freq, endFreq, type = 'sine', duration = 0.12, volume = 0.14, delay = 0 }) {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    }

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(volume, start + Math.min(0.015, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0008, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.01);
  }

  playButtonTap() {
    this.playTone({ freq: 540, endFreq: 820, type: 'sine', duration: 0.08, volume: 0.12 });
  }

  playCapsuleDrop(index = 0) {
    if (!this.sfxEnabled) return;
    const now = performance.now();
    if (now - this.lastDropSfxTime < 48) return;
    this.lastDropSfxTime = now;

    const note = PENTATONIC_DROPS[index % PENTATONIC_DROPS.length];
    this.playTone({
      freq: note * 0.96,
      endFreq: note * 1.05,
      type: 'sine',
      duration: 0.075,
      volume: 0.09,
    });
  }

  playCrankTick(stepIndex = 0) {
    if (!this.sfxEnabled) return;
    const base = 330 + (stepIndex % 6) * 28;
    this.playTone({
      freq: base,
      endFreq: base * 0.65,
      type: 'triangle',
      duration: 0.045,
      volume: 0.085,
    });
  }

  playCapsuleChuteDrop() {
    if (!this.sfxEnabled) return;
    this.ensureContext();
    this.playTone({ freq: 280, endFreq: 540, type: 'sine', duration: 0.16, volume: 0.16, delay: 0.42 });
    this.playTone({ freq: 660, endFreq: 900, type: 'triangle', duration: 0.2, volume: 0.16, delay: 0.62 });
  }

  playCrankSpin() {
    if (!this.sfxEnabled) return;
    this.ensureContext();
    // Mechanical cute ratchet clicks + swirl + chute clunk
    const clickTimes = [0, 0.09, 0.18, 0.28, 0.39, 0.51, 0.65, 0.80, 0.96];
    clickTimes.forEach((t, idx) => {
      this.playTone({
        freq: 320 + idx * 38,
        endFreq: 190 + idx * 20,
        type: 'triangle',
        duration: 0.055,
        volume: 0.13,
        delay: t,
      });
    });

    // Capsule rolling out & bouncing onto stage
    this.playTone({ freq: 260, endFreq: 520, type: 'sine', duration: 0.15, volume: 0.16, delay: 1.12 });
    this.playTone({ freq: 660, endFreq: 880, type: 'triangle', duration: 0.18, volume: 0.16, delay: 1.28 });
  }

  playCapsuleWobble() {
    this.playTone({ freq: 440, endFreq: 680, type: 'sine', duration: 0.11, volume: 0.11 });
  }

  playCapsuleReveal() {
    if (!this.sfxEnabled) return;
    this.ensureContext();
    // Crisp POP!
    this.playTone({ freq: 300, endFreq: 980, type: 'sine', duration: 0.1, volume: 0.22, delay: 0 });
    // Sparkling anime celesta fanfare!
    const fanfare = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
    fanfare.forEach((freq, i) => {
      this.playTone({
        freq,
        type: 'triangle',
        duration: i === fanfare.length - 1 ? 0.52 : 0.22,
        volume: 0.15,
        delay: 0.08 + i * 0.065,
      });
    });
  }

  playReturnToBox() {
    if (!this.sfxEnabled) return;
    this.playTone({ freq: 780, endFreq: 420, type: 'sine', duration: 0.18, volume: 0.14, delay: 0 });
    this.playTone({ freq: 520, endFreq: 660, type: 'triangle', duration: 0.12, volume: 0.12, delay: 0.18 });
  }

  playChibiSpeechBlips(count = 10, onDone = null) {
    const ctx = this.ensureContext();
    const notes = [659.25, 783.99, 880.0, 987.77, 1046.5];
    let stopped = false;
    const stepMs = 88;

    for (let i = 0; i < count; i++) {
      const f = notes[(i * 3 + Math.floor(Math.random() * 2)) % notes.length];
      if (ctx) {
        this.playTone({
          freq: f * 0.92,
          endFreq: f * 1.08,
          type: 'sine',
          duration: 0.065,
          volume: 0.11,
          delay: (i * stepMs) / 1000,
        });
      }
    }

    const doneTimer = setTimeout(() => {
      if (!stopped) onDone?.();
    }, count * stepMs + 80);

    return () => {
      stopped = true;
      clearTimeout(doneTimer);
    };
  }

  playGrandFinale() {
    if (!this.sfxEnabled) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5, 1567.98];
    notes.forEach((f, idx) => {
      this.playTone({
        freq: f,
        type: 'triangle',
        duration: idx === notes.length - 1 ? 0.75 : 0.22,
        volume: 0.16,
        delay: idx * 0.09,
      });
    });
  }
}
