import {
  ALL_VOICE_CLIP_KEYS,
  numberToClipSteps,
  numberToDigitRepeatSteps,
} from './offlineVoiceClips.js';

const VOICE_PREF_KEY = 'kawaii_gachapon_voice_v1';
const THAI_DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];

export function numberToThaiWords(num) {
  const n = Math.floor(Math.abs(Number(num) || 0));
  if (n === 0) return THAI_DIGITS[0];
  if (n < 10) return THAI_DIGITS[n];

  let rem = n;
  let out = '';

  if (rem >= 1000) {
    out += THAI_DIGITS[Math.floor(rem / 1000)] + 'พัน';
    rem %= 1000;
  }
  if (rem >= 100) {
    out += THAI_DIGITS[Math.floor(rem / 100)] + 'ร้อย';
    rem %= 100;
  }
  if (rem >= 10) {
    const tens = Math.floor(rem / 10);
    if (tens === 1) out += 'สิบ';
    else if (tens === 2) out += 'ยี่สิบ';
    else out += THAI_DIGITS[tens] + 'สิบ';
    rem %= 10;
  }
  if (rem > 0) {
    out += rem === 1 && n > 10 ? 'เอ็ด' : THAI_DIGITS[rem];
  }
  return out;
}

export function numberToThaiDigitsRepeat(num) {
  const clean = String(Math.floor(Math.abs(Number(num) || 0)));
  if (clean.length <= 1) {
    return `หมายเลข ${THAI_DIGITS[Number(clean)]}`;
  }
  return clean
    .split('')
    .map((ch) => THAI_DIGITS[Number(ch)] || ch)
    .join(' ');
}

function pickRandom(list, lastIndexRef, key) {
  if (list.length <= 1) return list[0];
  let idx = Math.floor(Math.random() * list.length);
  if (idx === lastIndexRef[key]) {
    idx = (idx + 1) % list.length;
  }
  lastIndexRef[key] = idx;
  return list[idx];
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

export class MascotVoice {
  constructor({ sound, onStateChange }) {
    this.sound = sound;
    this.onStateChange = onStateChange;

    this.voiceEnabled = this.loadPref();
    this.isSpeaking = false;
    this.currentBubbleText = '';

    this.speakToken = 0;
    this.activeSources = [];
    this.fallbackStopFn = null;
    this.watchdogTimer = null;
    this.pendingResolve = null;

    this.clipRawBytesCache = new Map();
    this.clipAudioBufferCache = new Map();
    this.lastPicked = {};

    this.warmUpRawClips();
  }

  loadPref() {
    try {
      const raw = localStorage.getItem(VOICE_PREF_KEY);
      if (raw === null) return true;
      return JSON.parse(raw) !== false;
    } catch {
      return true;
    }
  }

  savePref() {
    try {
      localStorage.setItem(VOICE_PREF_KEY, JSON.stringify(this.voiceEnabled));
    } catch {
      // Ignore storage quota issues
    }
  }

  warmUpRawClips() {
    const embedded = typeof window !== 'undefined' ? window.__EMBEDDED_VOICE__ : null;
    if (embedded) {
      for (const [k, b64] of Object.entries(embedded)) {
        this.clipRawBytesCache.set(k, base64ToArrayBuffer(b64));
      }
      return;
    }
    // Pre-fetch core clips quietly in background so offline/PWA memory cache is warm
    const coreKeys = [
      'crank_1', 'crank_2', 'wait_1', 'rev_pre_1', 'w_kha', 'rev_out_1',
      'd_0', 'd_1', 'd_2', 'd_3', 'd_4', 'd_5', 'd_6', 'd_7', 'd_8', 'd_9',
      'u_et', 'u_sip', 'u_yisip', 'u_roi',
    ];
    for (const k of coreKeys) {
      this.fetchClipRawBytes(k).catch(() => {});
    }
  }

  async fetchClipRawBytes(key) {
    if (this.clipRawBytesCache.has(key)) {
      return this.clipRawBytesCache.get(key);
    }
    const embedded = typeof window !== 'undefined' ? window.__EMBEDDED_VOICE__ : null;
    if (embedded && embedded[key]) {
      const buf = base64ToArrayBuffer(embedded[key]);
      this.clipRawBytesCache.set(key, buf);
      return buf;
    }
    const resp = await fetch(`./assets/voice/${key}.mp3`);
    if (!resp.ok) throw new Error(`Missing voice clip: ${key}`);
    const arrayBuf = await resp.arrayBuffer();
    this.clipRawBytesCache.set(key, arrayBuf);
    return arrayBuf;
  }

  async getDecodedClip(ctx, key) {
    if (this.clipAudioBufferCache.has(key)) {
      return this.clipAudioBufferCache.get(key);
    }
    const raw = await this.fetchClipRawBytes(key);
    // decodeAudioData detaches ArrayBuffer, so pass a copy `.slice(0)`
    const decoded = await new Promise((resolve, reject) => {
      ctx.decodeAudioData(raw.slice(0), resolve, reject);
    });
    this.clipAudioBufferCache.set(key, decoded);
    return decoded;
  }

  toggleVoice(allowPreviewSpeech = true) {
    this.voiceEnabled = !this.voiceEnabled;
    this.savePref();
    if (!this.voiceEnabled) {
      this.stopSpeaking();
    } else if (allowPreviewSpeech) {
      this.playSequence({
        bubbleText: 'ฮัลโหล~ เปิดเสียงพากย์ภาษาไทยของน้องโมจิแล้วจ้า! 🎤✨',
        steps: [{ key: 'voice_on', gapAfter: 0 }],
      });
    }
    return this.voiceEnabled;
  }

  setSpeakingState(speaking, bubbleText = null) {
    const changed =
      this.isSpeaking !== speaking ||
      (bubbleText !== null && bubbleText !== this.currentBubbleText);

    this.isSpeaking = speaking;
    if (bubbleText !== null) {
      this.currentBubbleText = bubbleText;
    }
    this.sound?.setVoiceDucking(speaking);

    if (changed) {
      this.onStateChange?.({
        isSpeaking: this.isSpeaking,
        speechText: this.currentBubbleText,
      });
    }
  }

  resolvePending() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.pendingResolve) {
      const fn = this.pendingResolve;
      this.pendingResolve = null;
      fn();
    }
  }

  stopSpeaking() {
    this.speakToken++;
    if (this.activeSources.length > 0) {
      for (const src of this.activeSources) {
        try {
          src.onended = null;
          src.stop();
        } catch {
          // Ignore already stopped sources
        }
      }
      this.activeSources = [];
    }
    if (this.fallbackStopFn) {
      this.fallbackStopFn();
      this.fallbackStopFn = null;
    }
    this.setSpeakingState(false);
    this.resolvePending();
  }

  /**
   * Plays a gapless/timed sequence of offline Thai voice clips at 1.28x Chibi pitch
   * and returns a Promise<void> that resolves as soon as the final clip completes.
   */
  playSequence({ bubbleText, steps }) {
    const display = bubbleText || '';
    if (!this.voiceEnabled || !steps || steps.length === 0) {
      this.stopSpeaking();
      this.setSpeakingState(false, display);
      return Promise.resolve();
    }

    this.stopSpeaking();
    const token = ++this.speakToken;
    this.setSpeakingState(false, display);

    const ctx = this.sound?.ensureContext();
    if (!ctx) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.pendingResolve = resolve;

      const finishCurrent = () => {
        if (token !== this.speakToken) return;
        this.activeSources = [];
        this.setSpeakingState(false);
        this.resolvePending();
      };

      (async () => {
        try {
          const buffers = await Promise.all(steps.map((st) => this.getDecodedClip(ctx, st.key)));
          if (token !== this.speakToken) return;

          if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
            await ctx.resume().catch(() => {});
          }
          if (token !== this.speakToken) return;

          const rate = 1.28; // Cute high-pitched Chibi anime voice!
          const voiceGain = ctx.createGain();
          voiceGain.gain.value = 1.18;
          voiceGain.connect(ctx.destination);

          let cursor = ctx.currentTime + 0.025;
          const sources = [];

          for (let i = 0; i < buffers.length; i++) {
            const buf = buffers[i];
            const gapAfter = steps[i].gapAfter ?? 0.03;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.playbackRate.value = rate;
            src.connect(voiceGain);
            src.start(cursor);
            sources.push(src);

            const dur = buf.duration / rate;
            cursor = Math.max(cursor + 0.045, cursor + dur + gapAfter);
          }

          this.activeSources = sources;
          this.setSpeakingState(true, display);

          const totalMs = Math.max(300, (cursor - ctx.currentTime) * 1000);
          this.watchdogTimer = setTimeout(finishCurrent, totalMs + 550);

          const lastSrc = sources[sources.length - 1];
          lastSrc.onended = finishCurrent;
        } catch {
          if (token !== this.speakToken) return;
          this.setSpeakingState(true, display);
          const count = Math.min(14, Math.max(5, steps.length * 3));
          this.watchdogTimer = setTimeout(finishCurrent, count * 95 + 500);
          this.fallbackStopFn = this.sound?.playChibiSpeechBlips(count, () => {
            if (token === this.speakToken) {
              this.fallbackStopFn = null;
              finishCurrent();
            }
          });
        }
      })();
    });
  }

  // --- Contextual Offline Thai Dialogue Generators ---

  speakPouringStart(count) {
    const numSteps = numberToClipSteps(count);
    const variants = [
      {
        bubbleText: `ว้าวว~ กำลังเทฉลากทั้งหมด ${count} ใบลงโหลใสแล้วจ้า! 🎀`,
        steps: [
          { key: 'pour_a1', gapAfter: 0.03 },
          ...numSteps,
          { key: 'w_bai', gapAfter: 0.06 },
          { key: 'pour_a2', gapAfter: 0 },
        ],
      },
      {
        bubbleText: `มาแล้วจ้า! สร้างแคปซูลของขวัญ ${count} ลูกเข้าตู้เรียบร้อย~ ✨`,
        steps: [
          { key: 'pour_b1', gapAfter: 0.03 },
          ...numSteps,
          { key: 'w_luk', gapAfter: 0.06 },
          { key: 'pour_b2', gapAfter: 0 },
        ],
      },
    ];
    return this.playSequence(pickRandom(variants, this.lastPicked, 'pouring'));
  }

  speakFewLeftIfNeeded(remainingCount) {
    if (remainingCount <= 0 || remainingCount > 3) return Promise.resolve();
    if (remainingCount === 1) {
      return this.playSequence({
        bubbleText: 'เหลือลูกแคปซูลใบสุดท้ายในตู้แล้วจ้า! ลุ้นสุดๆ เลย~ 💓',
        steps: [{ key: 'few_last', gapAfter: 0 }],
      });
    }
    return this.playSequence({
      bubbleText: `ตื่นเต้นจัง! เหลือฉลากอีกแค่ ${remainingCount} ใบสุดท้ายแล้วน้า~ 💓`,
      steps: [
        { key: 'few_n1', gapAfter: 0.03 },
        ...numberToClipSteps(remainingCount),
        { key: 'w_bai', gapAfter: 0.02 },
        { key: 'few_n2', gapAfter: 0 },
      ],
    });
  }

  speakCranking() {
    const variants = [
      {
        bubbleText: 'หมุนติ้วๆ เลยจ้า~ รอบนี้จะได้เลขอะไรน้าา... 🌟',
        steps: [{ key: 'crank_1', gapAfter: 0 }],
      },
      {
        bubbleText: 'ลุ้นๆๆ ใครจะเป็นผู้โชคดีคนต่อไปคะเนี่ย! ✨',
        steps: [{ key: 'crank_2', gapAfter: 0 }],
      },
      {
        bubbleText: 'กริ๊งๆ กำลังคลุกแคปซูลสุ่มให้เลยจ้า~! 🎰',
        steps: [{ key: 'crank_3', gapAfter: 0 }],
      },
      {
        bubbleText: 'เพี้ยงง~ ขอให้ได้ของขวัญที่ถูกใจน้า! 🎀',
        steps: [{ key: 'crank_4', gapAfter: 0 }],
      },
    ];
    return this.playSequence(pickRandom(variants, this.lastPicked, 'crank'));
  }

  speakCapsuleWaiting() {
    const variants = [
      {
        bubbleText: 'แคปซูลหล่นออกมาแล้ว! แตะที่ลูกแคปซูลเพื่อแกะดูเลขเร็ว~ 🎊',
        steps: [{ key: 'wait_1', gapAfter: 0 }],
      },
      {
        bubbleText: 'ออกมาแล้ว 1 ลูก! กดเปิดฝาแคปซูลลุ้นหมายเลขเลยจ้า~ 🎁',
        steps: [{ key: 'wait_2', gapAfter: 0 }],
      },
      {
        bubbleText: 'สีน่ารักซะด้วย~ แตะเปิดดูเลขข้างในได้เลยน้า! ✨',
        steps: [{ key: 'wait_3', gapAfter: 0 }],
      },
    ];
    return this.playSequence(pickRandom(variants, this.lastPicked, 'waiting'));
  }

  speakNumberRevealed(number) {
    const digitCall = numberToThaiDigitsRepeat(number);
    const fullSteps = numberToClipSteps(number);
    const digitSteps = numberToDigitRepeatSteps(number);

    const variants = [
      {
        bubbleText: `ทาด๊าา~! ได้หมายเลข #${number} (${digitCall}) ยินดีด้วยจ้าา 🎉`,
        steps: [
          { key: 'rev_pre_1', gapAfter: 0.03 },
          ...fullSteps,
          { key: 'w_kha', gapAfter: 0.16 },
          ...digitSteps,
          { key: 'rev_out_1', gapAfter: 0 },
        ],
      },
      {
        bubbleText: `ว้าวว~! ผู้โชคดีได้แก่ หมายเลข #${number} มารับของขวัญเลยจ้า 🎁`,
        steps: [
          { key: 'rev_pre_2', gapAfter: 0.03 },
          ...fullSteps,
          { key: 'w_kha', gapAfter: 0.16 },
          ...digitSteps,
          { key: 'rev_out_2', gapAfter: 0 },
        ],
      },
      {
        bubbleText: `ปิ๊งป่อง~! ออกหมายเลข #${number} ขอเสียงปรบมือหน่อยจ้าา 🥳`,
        steps: [
          { key: 'rev_pre_3', gapAfter: 0.03 },
          ...fullSteps,
          { key: 'w_kha', gapAfter: 0.16 },
          ...digitSteps,
          { key: 'rev_out_3', gapAfter: 0 },
        ],
      },
      {
        bubbleText: `เย้~! เปิดได้หมายเลข #${number} โชคดีสุดๆ ไปเลยค่า 💖`,
        steps: [
          { key: 'rev_pre_4', gapAfter: 0.03 },
          ...fullSteps,
          { key: 'w_kha', gapAfter: 0.16 },
          ...digitSteps,
          { key: 'rev_out_4', gapAfter: 0 },
        ],
      },
    ];
    return this.playSequence(pickRandom(variants, this.lastPicked, 'reveal'));
  }

  speakRepeatNumber(number) {
    const digitCall = numberToThaiDigitsRepeat(number);
    return this.playSequence({
      bubbleText: `🔊 ทวนอีกครั้งน้า! ได้หมายเลข #${number} (${digitCall}) ยินดีด้วยจ้า 🎉`,
      steps: [
        { key: 'rev_rep', gapAfter: 0.03 },
        ...numberToClipSteps(number),
        { key: 'w_kha', gapAfter: 0.16 },
        ...numberToDigitRepeatSteps(number),
        { key: 'rev_out_2', gapAfter: 0 },
      ],
    });
  }

  speakReturnToBox(number) {
    return this.playSequence({
      bubbleText: `นำหมายเลข #${number} ใส่กลับเข้าตู้เรียบร้อย เตรียมสุ่มใหม่ได้เลยจ้า! ↩️`,
      steps: [
        { key: 'ret_1', gapAfter: 0.03 },
        ...numberToClipSteps(number),
        { key: 'ret_2', gapAfter: 0 },
      ],
    });
  }

  speakGrandFinale(total) {
    return this.playSequence({
      bubbleText: `เย้~! จับฉลากครบทั้ง ${total} ใบหมดตู้เรียบร้อยแล้วจ้า ขอบคุณทุกคนนะค้า 🥳💖`,
      steps: [
        { key: 'fin_1', gapAfter: 0.03 },
        ...numberToClipSteps(total),
        { key: 'w_bai', gapAfter: 0.04 },
        { key: 'fin_2', gapAfter: 0 },
      ],
    });
  }

  speakInteractivePoke(state) {
    const { phase, drawnHistory, remainingTickets } = state;
    if (phase === 'setup') {
      return this.playSequence({
        bubbleText: 'ฮิฮิ~ ตั้งค่าจำนวนฉลากแล้วมาหมุนกาชาปองสนุกๆ กันน้า! ✨',
        steps: [{ key: 'poke_setup', gapAfter: 0 }],
      });
    }
    if (phase === 'completed') {
      return this.playSequence({
        bubbleText: 'จับครบทุกใบแล้วเก่งมากๆ เลย~ กดเริ่มรอบใหม่ได้ตลอดเลยน้า! 🎊',
        steps: [{ key: 'poke_done', gapAfter: 0 }],
      });
    }
    if (drawnHistory.length > 0 && Math.random() < 0.55) {
      const latest = drawnHistory[0].number;
      return this.playSequence({
        bubbleText: `ใบล่าสุดคือหมายเลข #${latest} จ้า เหลือในตู้อีก ${remainingTickets.length} ใบน้า~ 🎀`,
        steps: [
          { key: 'poke_lat_1', gapAfter: 0.03 },
          ...numberToClipSteps(latest),
          { key: 'poke_lat_2', gapAfter: 0.03 },
          ...numberToClipSteps(remainingTickets.length),
          { key: 'poke_lat_3', gapAfter: 0 },
        ],
      });
    }
    const greetings = [
      {
        bubbleText: 'ฮิฮิ~ น้องโมจิพร้อมพากย์เชียร์เต็มที่เลยจ้า กดหมุนตู้กันเร็ว! 💖',
        steps: [{ key: 'poke_1', gapAfter: 0 }],
      },
      {
        bubbleText: 'ตื่นเต้นจังเลย~ ใบต่อไปจะเป็นของใครกันน้าา! 🌟',
        steps: [{ key: 'poke_2', gapAfter: 0 }],
      },
      {
        bubbleText: 'สู้ๆ นะค้าทุกคน ขอให้จับได้ของขวัญที่อยากได้น้า~! 🎁',
        steps: [{ key: 'poke_3', gapAfter: 0 }],
      },
    ];
    return this.playSequence(pickRandom(greetings, this.lastPicked, 'poke'));
  }
}

export { ALL_VOICE_CLIP_KEYS };
