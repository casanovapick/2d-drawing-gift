import { GameStore, CAPSULE_THEMES, getThemeForTicket } from './state/gameStore.js';
import { SoundEngine } from './audio/soundEngine.js';
import { MascotVoice } from './audio/mascotVoice.js';
import { GachaponMachine } from './components/gachaponMachine.js';
import {
  getMascotMoodAndSpeech,
  mountOrUpdateMascotFigure,
  preloadMascotSprites,
} from './components/chibiMascot.js';
import { ConfettiOverlay } from './components/confettiOverlay.js';

const PRESET_COUNTS = [10, 20, 30, 50, 100, 200];

class KawaiiGachaponApp {
  constructor(rootEl) {
    this.root = rootEl;
    this.store = new GameStore();
    this.sound = new SoundEngine();
    this.voice = new MascotVoice({
      sound: this.sound,
      onStateChange: ({ isSpeaking, speechText }) => {
        this.handleVoiceStateChange(isSpeaking, speechText);
      },
    });

    this.setupDraftCount = this.store.state.totalTickets || 30;
    this.showResetConfirm = false;
    this.currentMood = 'idle';

    // Synchronization gates so Mochi-chan is never cut off mid-sentence
    this.flowRunId = 0;
    this.voiceGateLocked = false;
    this.fillingPhysicsDone = false;
    this.fillingSpeechDone = false;
    this.capsuleTapLocked = false;
    this.revealButtonsLocked = false;
    this.mutedCrankTimer = null;

    preloadMascotSprites();
    this.buildShell();
    this.bindEvents();

    const initState = this.store.state;
    if (initState.phase !== 'setup' && initState.remainingTickets.length > 0) {
      this.machine.syncTicketsInstant(initState.remainingTickets);
    }
    this.renderUI(initState, { type: 'INIT' });

    this.store.subscribe((state, meta) => {
      this.renderUI(state, meta);
    });
  }

  buildShell() {
    this.root.innerHTML = `
      <div class="party-bg-decor" aria-hidden="true">
        <div class="bunting-row"></div>
        <span class="floating-deco deco-1">🎁</span>
        <span class="floating-deco deco-2">🎀</span>
        <span class="floating-deco deco-3">✨</span>
        <span class="floating-deco deco-4">🌟</span>
      </div>

      <!-- Top Navigation / Party Bar -->
      <header class="topbar">
        <div class="brand-badge">
          <span class="brand-icon">🎁</span>
          <div>
            <h1 class="brand-title">Kawaii Gift Gachapon!</h1>
            <p class="brand-sub">เกมหมุนตู้จับฉลากของขวัญ</p>
          </div>
        </div>

        <div class="topbar-controls">
          <button type="button" id="btn-voice" class="pill-btn pill-btn-voice" title="เปิด/ปิดเสียงพากย์พิธีกรน้องโมจิ">
            🎤 พากย์: เปิด
          </button>
          <button type="button" id="btn-bgm" class="pill-btn" title="เปิด/ปิดเพลงพื้นหลัง">
            🎵 เพลง: เปิด
          </button>
          <button type="button" id="btn-sfx" class="pill-btn" title="เปิด/ปิดเสียงเอฟเฟกต์">
            🔊 เสียง: เปิด
          </button>
          <button type="button" id="btn-fullscreen" class="pill-btn hide-sm" title="ขยายเต็มจอสำหรับขึ้นทีวี/โปรเจกเตอร์">
            ⛶ เต็มจอ
          </button>
          <button type="button" id="btn-reset" class="pill-btn pill-btn-warn" title="ตั้งค่าจำนวนฉลากใหม่">
            🔄 เริ่มใหม่
          </button>
        </div>
      </header>

      <!-- Main 3-Zone Responsive Stage -->
      <main class="stage-grid">
        <!-- Left Zone: Counter + Interactive Speaking Chibi Mascot -->
        <section class="left-panel">
          <div class="counter-card">
            <div class="counter-header">
              <span class="counter-label">ฉลากที่เหลือในตู้</span>
              <span id="total-pill" class="total-pill">ทั้งหมด 30 ใบ</span>
            </div>
            <div class="counter-numbers">
              <span id="remaining-count" class="remaining-big">0</span>
              <span class="remaining-unit">ใบ</span>
            </div>
            <div class="progress-track">
              <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
            </div>
          </div>

          <div
            id="mascot-card"
            class="mascot-card mascot-interactive"
            role="button"
            tabindex="0"
            title="แตะที่น้องโมจิเพื่อพูดคุยหรือให้ทวนเลขล่าสุด!"
          >
            <div class="speech-bubble">
              <div id="voice-eq-main" class="voice-eq-bars hidden" aria-hidden="true">
                <span></span><span></span><span></span>
              </div>
              <p id="mascot-speech">ใส่จำนวนฉลากที่จะสร้างลงตู้ได้เลยน้า~ ✨</p>
            </div>
            <div id="mascot-figure" class="mascot-figure"></div>
            <div class="mascot-footer-row">
              <span class="mascot-name-tag">🎤 พิธีกรน้องโมจิ</span>
              <span class="mascot-tap-hint">แตะพูดคุยได้น้า~</span>
            </div>
          </div>
        </section>

        <!-- Center Zone: Gachapon Machine & Primary Draw Button -->
        <section class="center-panel">
          <div class="machine-stage">
            <canvas id="gachapon-canvas"></canvas>
          </div>

          <div class="draw-action-wrap">
            <button type="button" id="btn-draw" class="draw-cta-btn">
              <span class="draw-cta-icon">🎰</span>
              <span id="draw-cta-label">หมุนจับฉลาก!</span>
            </button>
            <p id="draw-hint" class="draw-hint">กดปุ่มด้านบน แตะก้านหมุนที่ตู้ หรือกดปุ่ม Spacebar เพื่อสุ่มทีละใบ</p>
          </div>
        </section>

        <!-- Right Zone: Drawn Numbers History Board -->
        <aside class="right-panel">
          <div class="history-card">
            <div class="history-header">
              <h2 class="history-title">📜 เลขที่ออกแล้ว</h2>
              <span id="drawn-count-badge" class="drawn-count-badge">0 ใบ</span>
            </div>

            <div id="latest-draw-box" class="latest-draw-box hidden"></div>

            <div id="history-list" class="history-list"></div>
          </div>
        </aside>
      </main>

      <!-- Setup Overlay Modal (Initial / New Game) -->
      <div id="setup-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <div class="modal-card setup-card">
          <div class="setup-ribbon">🎀 ตั้งค่ากล่องจับฉลาก 🎀</div>
          <h2 id="setup-title" class="setup-heading">ใส่จำนวนฉลากของขวัญ</h2>
          <p class="setup-desc">ระบบจะสร้างลูกแคปซูลหมายเลข <strong>1 ถึง N</strong> เทลงโหลใสตามจำนวนที่กำหนด</p>

          <div class="number-stepper">
            <button type="button" id="btn-dec-count" class="step-btn" aria-label="ลดจำนวน">−</button>
            <input
              type="number"
              id="input-ticket-count"
              class="count-input"
              min="1"
              max="500"
              value="30"
              inputmode="numeric"
            />
            <button type="button" id="btn-inc-count" class="step-btn" aria-label="เพิ่มจำนวน">+</button>
          </div>
          <p class="range-note">รองรับตั้งแต่ 1 ถึง 500 ใบ</p>

          <div class="preset-chips" id="preset-chips">
            ${PRESET_COUNTS.map(
              (n) => `<button type="button" class="chip-btn" data-preset="${n}">${n} ใบ</button>`
            ).join('')}
          </div>

          <button type="button" id="btn-start-game" class="primary-big-btn">
            ✨ สร้างฉลากลงตู้เลย!
          </button>
        </div>
      </div>

      <!-- 2-Step Capsule Suspense & Reveal Modal -->
      <div id="capsule-modal" class="modal-backdrop capsule-backdrop hidden" role="dialog" aria-modal="true">
        <div class="sunburst-rays" aria-hidden="true"></div>
        <div id="capsule-modal-stack" class="capsule-modal-stack">
          <!-- Half-Body Frameless Presenter Stage (shown ONLY when revealed!) -->
          <div id="modal-mascot-stage" class="modal-mascot-stage hidden" title="แตะให้น้องโมจิขานหมายเลขซ้ำได้น้า~">
            <div id="modal-mascot-figure" class="modal-mascot-halfbody"></div>
            <div class="modal-mascot-bubble">
              <div class="modal-mascot-header">
                <span class="modal-mascot-tag">🎤 น้องโมจิพากย์สด</span>
                <div id="voice-eq-modal" class="voice-eq-bars hidden" aria-hidden="true">
                  <span></span><span></span><span></span>
                </div>
              </div>
              <p id="modal-mascot-speech">ทาด๊าา~! ยินดีด้วยนะค้าา 🎉</p>
            </div>
          </div>

          <div id="capsule-stage-content" class="capsule-stage-content"></div>
        </div>
      </div>

      <!-- Reset Confirmation Modal -->
      <div id="reset-modal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
        <div class="modal-card confirm-card">
          <div class="confirm-emoji">🔄</div>
          <h3 class="confirm-title">เริ่มตั้งค่าฉลากใหม่ไหมคะ?</h3>
          <p class="confirm-desc">ฉลากที่เหลือในตู้และประวัติเลขที่จับไปแล้วในรอบนี้จะถูกรีเซ็ตทั้งหมดน้า~</p>
          <div class="confirm-actions">
            <button type="button" id="btn-cancel-reset" class="secondary-btn">ยกเลิก</button>
            <button type="button" id="btn-confirm-reset" class="danger-pink-btn">เริ่มรอบใหม่เลย!</button>
          </div>
        </div>
      </div>

      <!-- Celebration Confetti Canvas -->
      <canvas id="confetti-canvas" class="confetti-canvas" aria-hidden="true"></canvas>
    `;

    this.els = {
      btnVoice: this.root.querySelector('#btn-voice'),
      btnBgm: this.root.querySelector('#btn-bgm'),
      btnSfx: this.root.querySelector('#btn-sfx'),
      btnFullscreen: this.root.querySelector('#btn-fullscreen'),
      btnReset: this.root.querySelector('#btn-reset'),
      totalPill: this.root.querySelector('#total-pill'),
      remainingCount: this.root.querySelector('#remaining-count'),
      progressFill: this.root.querySelector('#progress-fill'),
      mascotCard: this.root.querySelector('#mascot-card'),
      voiceEqMain: this.root.querySelector('#voice-eq-main'),
      mascotSpeech: this.root.querySelector('#mascot-speech'),
      mascotFigure: this.root.querySelector('#mascot-figure'),
      gachaponCanvas: this.root.querySelector('#gachapon-canvas'),
      btnDraw: this.root.querySelector('#btn-draw'),
      drawCtaLabel: this.root.querySelector('#draw-cta-label'),
      drawHint: this.root.querySelector('#draw-hint'),
      drawnCountBadge: this.root.querySelector('#drawn-count-badge'),
      latestDrawBox: this.root.querySelector('#latest-draw-box'),
      historyList: this.root.querySelector('#history-list'),
      setupModal: this.root.querySelector('#setup-modal'),
      inputTicketCount: this.root.querySelector('#input-ticket-count'),
      btnDecCount: this.root.querySelector('#btn-dec-count'),
      btnIncCount: this.root.querySelector('#btn-inc-count'),
      presetChips: this.root.querySelector('#preset-chips'),
      btnStartGame: this.root.querySelector('#btn-start-game'),
      capsuleModal: this.root.querySelector('#capsule-modal'),
      capsuleModalStack: this.root.querySelector('#capsule-modal-stack'),
      modalMascotStage: this.root.querySelector('#modal-mascot-stage'),
      modalMascotFigure: this.root.querySelector('#modal-mascot-figure'),
      modalMascotSpeech: this.root.querySelector('#modal-mascot-speech'),
      voiceEqModal: this.root.querySelector('#voice-eq-modal'),
      capsuleStageContent: this.root.querySelector('#capsule-stage-content'),
      resetModal: this.root.querySelector('#reset-modal'),
      btnCancelReset: this.root.querySelector('#btn-cancel-reset'),
      btnConfirmReset: this.root.querySelector('#btn-confirm-reset'),
      confettiCanvas: this.root.querySelector('#confetti-canvas'),
    };

    this.confetti = new ConfettiOverlay(this.els.confettiCanvas);
    this.machine = new GachaponMachine(this.els.gachaponCanvas, {
      sound: this.sound,
      onCrankClick: () => this.handleDrawTrigger(),
      onFillingComplete: () => {
        this.fillingPhysicsDone = true;
        this.checkFillingCompletionGate(this.flowRunId);
      },
      onCrankComplete: () => {
        this.voiceGateLocked = false;
        this.store.onCapsuleDroppedToStage();
      },
    });
  }

  clearFlowTimers() {
    if (this.mutedCrankTimer) {
      clearTimeout(this.mutedCrankTimer);
      this.mutedCrankTimer = null;
    }
  }

  checkFillingCompletionGate(runId) {
    if (runId !== this.flowRunId) return;
    if (this.store.state.phase !== 'filling') return;
    if (this.fillingPhysicsDone && this.fillingSpeechDone) {
      this.voiceGateLocked = false;
      this.store.finishFilling();
    } else if (this.fillingPhysicsDone && !this.fillingSpeechDone) {
      this.els.drawCtaLabel.textContent = 'รอน้องโมจิพูดต้อนรับแป๊บนึงน้า...';
    }
  }

  bindEvents() {
    const unlockAudioHandler = () => {
      this.sound.unlockIOSAudio();
    };
    window.addEventListener('touchstart', unlockAudioHandler, { passive: true });
    window.addEventListener('touchend', unlockAudioHandler, { passive: true });
    window.addEventListener('pointerdown', unlockAudioHandler, { once: true });
    window.addEventListener('keydown', unlockAudioHandler, { once: true });

    // Hide desktop Fullscreen button on iOS or when already running as Home Screen standalone app
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone =
      Boolean(window.navigator.standalone) ||
      window.matchMedia?.('(display-mode: standalone)')?.matches;
    if (isIOS || isStandalone || !document.documentElement.requestFullscreen) {
      this.els.btnFullscreen.classList.add('hidden');
    }

    window.addEventListener('resize', () => {
      this.machine.resize();
    });

    // Voice, BGM, SFX, Fullscreen Controls
    this.els.btnVoice.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.voice.toggleVoice(!this.voiceGateLocked);
      this.updateAudioButtons();
    });

    this.els.btnBgm.addEventListener('click', () => {
      this.sound.toggleBgm();
      this.updateAudioButtons();
    });

    this.els.btnSfx.addEventListener('click', () => {
      this.sound.toggleSfx();
      this.updateAudioButtons();
    });

    this.els.btnFullscreen.addEventListener('click', () => {
      this.sound.playButtonTap();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });

    document.addEventListener('fullscreenchange', () => {
      const isFs = Boolean(document.fullscreenElement);
      this.els.btnFullscreen.textContent = isFs ? '🗗 ย่อจอ' : '⛶ เต็มจอ';
    });

    // Interactive Click / Enter on Mascot Card (only when not in a locked flow announcement!)
    const handleMascotPoke = () => {
      if (this.voiceGateLocked) return;
      this.sound.playButtonTap();
      this.els.mascotCard.classList.remove('mascot-poke-pop');
      void this.els.mascotCard.offsetWidth;
      this.els.mascotCard.classList.add('mascot-poke-pop');
      this.voice.speakInteractivePoke(this.store.state);
    };

    this.els.mascotCard.addEventListener('click', handleMascotPoke);
    this.els.mascotCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        handleMascotPoke();
      }
    });

    // Reset button
    this.els.btnReset.addEventListener('click', () => {
      this.sound.playButtonTap();
      const { phase } = this.store.state;
      if (phase === 'setup') return;
      if (phase === 'completed') {
        this.resetGameCleanly();
        return;
      }
      this.showResetConfirm = true;
      this.els.resetModal.classList.remove('hidden');
    });

    this.els.btnCancelReset.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.showResetConfirm = false;
      this.els.resetModal.classList.add('hidden');
    });

    this.els.btnConfirmReset.addEventListener('click', () => {
      this.sound.playButtonTap();
      this.showResetConfirm = false;
      this.els.resetModal.classList.add('hidden');
      this.resetGameCleanly();
    });

    // Setup Modal Controls
    const syncInputVal = (val) => {
      const clean = Math.min(500, Math.max(1, Math.floor(Number(val) || 1)));
      this.setupDraftCount = clean;
      this.els.inputTicketCount.value = String(clean);
      this.highlightActiveChip(clean);
    };

    this.els.btnDecCount.addEventListener('click', () => {
      this.sound.playButtonTap();
      syncInputVal((Number(this.els.inputTicketCount.value) || 1) - 1);
    });

    this.els.btnIncCount.addEventListener('click', () => {
      this.sound.playButtonTap();
      syncInputVal((Number(this.els.inputTicketCount.value) || 1) + 1);
    });

    this.els.inputTicketCount.addEventListener('input', () => {
      const num = Number(this.els.inputTicketCount.value);
      if (num >= 1 && num <= 500) {
        this.setupDraftCount = Math.floor(num);
        this.highlightActiveChip(this.setupDraftCount);
      }
    });

    this.els.inputTicketCount.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleStartSetup();
      }
    });

    this.els.presetChips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-preset]');
      if (!btn) return;
      this.sound.playButtonTap();
      syncInputVal(Number(btn.dataset.preset));
    });

    this.els.btnStartGame.addEventListener('click', () => {
      this.handleStartSetup();
    });

    // Main Draw CTA Button
    this.els.btnDraw.addEventListener('click', () => {
      const { phase } = this.store.state;
      if (phase === 'completed' || phase === 'setup') {
        this.sound.playButtonTap();
        this.resetGameCleanly();
        return;
      }
      this.handleDrawTrigger();
    });

    // Delegated clicks & hover inside 2-step Capsule Modal
    this.els.modalMascotStage?.addEventListener('click', () => {
      if (this.voiceGateLocked) return;
      const { phase, currentCapsule } = this.store.state;
      if (phase === 'revealed' && currentCapsule) {
        this.triggerRepeatVoiceLocked(currentCapsule.number);
      }
    });

    this.els.capsuleStageContent.addEventListener('pointerover', (e) => {
      if (
        !this.capsuleTapLocked &&
        e.target.closest('#btn-open-capsule') &&
        !e.relatedTarget?.closest('#btn-open-capsule')
      ) {
        this.sound.playCapsuleWobble();
      }
    });

    this.els.capsuleStageContent.addEventListener('click', (e) => {
      if (e.target.closest('#btn-open-capsule')) {
        this.handleOpenCapsuleStep2();
      } else if (e.target.closest('#btn-repeat-voice')) {
        const cap = this.store.state.currentCapsule;
        if (cap && !this.revealButtonsLocked) {
          this.triggerRepeatVoiceLocked(cap.number);
        }
      } else if (e.target.closest('#btn-confirm-reveal')) {
        if (this.revealButtonsLocked) return;
        this.sound.playButtonTap();
        this.store.confirmRevealedCapsule();
      } else if (e.target.closest('#btn-return-capsule')) {
        if (this.revealButtonsLocked) return;
        this.sound.playReturnToBox();
        this.store.returnRevealedCapsuleToBox();
      }
    });

    // Keyboard shortcuts (Space / Enter) — respects all voice gates!
    window.addEventListener('keydown', (e) => {
      if (this.showResetConfirm) {
        if (e.key === 'Escape') {
          this.showResetConfirm = false;
          this.els.resetModal.classList.add('hidden');
        }
        return;
      }

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space' || e.key === 'Enter') {
        const { phase } = this.store.state;
        if (phase === 'ready' && !this.voiceGateLocked) {
          e.preventDefault();
          this.handleDrawTrigger();
        } else if (phase === 'capsule_waiting' && !this.capsuleTapLocked) {
          e.preventDefault();
          this.handleOpenCapsuleStep2();
        } else if (phase === 'revealed' && !this.revealButtonsLocked) {
          e.preventDefault();
          this.sound.playButtonTap();
          this.store.confirmRevealedCapsule();
        }
      }
    });
  }

  resetGameCleanly() {
    this.flowRunId++;
    this.clearFlowTimers();
    this.voiceGateLocked = false;
    this.capsuleTapLocked = false;
    this.revealButtonsLocked = false;
    this.voice.stopSpeaking();
    this.machine.syncTicketsInstant([]);
    this.store.openSetupReset();
  }

  triggerRepeatVoiceLocked(number) {
    const runId = ++this.flowRunId;
    this.sound.playButtonTap();
    if (!this.voice.voiceEnabled) {
      this.voice.speakRepeatNumber(number);
      return;
    }
    this.revealButtonsLocked = true;
    this.voiceGateLocked = true;
    this.syncRevealButtonsLockUI();
    this.voice.speakRepeatNumber(number).then(() => {
      if (runId !== this.flowRunId || this.store.state.phase !== 'revealed') return;
      this.revealButtonsLocked = false;
      this.voiceGateLocked = false;
      this.syncRevealButtonsLockUI();
    });
  }

  handleVoiceStateChange(isSpeaking, speechText) {
    if (speechText) {
      this.els.mascotSpeech.textContent = speechText;
      this.els.modalMascotSpeech.textContent = speechText;
    }
    this.els.voiceEqMain.classList.toggle('hidden', !isSpeaking);
    this.els.voiceEqModal.classList.toggle('hidden', !isSpeaking);
    this.renderMascotFigures();
  }

  renderMascotFigures() {
    if (!this.els?.mascotFigure) return;
    const isSpeaking = Boolean(this.voice?.isSpeaking);
    mountOrUpdateMascotFigure(this.els.mascotFigure, this.currentMood, {
      isSpeaking,
      variant: 'full',
    });
    const { phase } = this.store.state;
    if (phase === 'revealed') {
      mountOrUpdateMascotFigure(this.els.modalMascotFigure, this.currentMood, {
        isSpeaking,
        variant: 'halfbody',
      });
    }
  }

  handleStartSetup() {
    const val = Math.min(500, Math.max(1, Math.floor(Number(this.els.inputTicketCount.value) || 30)));
    this.setupDraftCount = val;
    this.els.inputTicketCount.value = String(val);
    this.sound.playButtonTap();
    this.store.startGame(val);
  }

  handleDrawTrigger() {
    if (this.store.state.phase !== 'ready' || this.voiceGateLocked) return;
    this.store.startCrankDraw();
  }

  handleOpenCapsuleStep2() {
    if (this.store.state.phase !== 'capsule_waiting' || this.capsuleTapLocked) return;
    this.sound.playCapsuleReveal();
    this.confetti.burstCenter(95);
    this.store.openWaitingCapsule();
  }

  syncWaitingCapsuleLockUI() {
    const btn = this.els.capsuleStageContent.querySelector('#btn-open-capsule');
    const prompt = this.els.capsuleStageContent.querySelector('#waiting-prompt-badge');
    if (!btn || !prompt) return;

    btn.disabled = this.capsuleTapLocked;
    btn.classList.toggle('capsule-locked', this.capsuleTapLocked);
    if (this.capsuleTapLocked) {
      prompt.className = 'tap-capsule-prompt prompt-waiting-voice';
      prompt.innerHTML = '🎤 รอน้องโมจิพูดชวนให้จบแป๊บนึงน้า...';
    } else {
      prompt.className = 'tap-capsule-prompt';
      prompt.innerHTML =
        '👆 แตะที่ลูกแคปซูลเพื่อเปิดดูหมายเลข! <span class="hide-sm">(หรือกด Spacebar)</span>';
    }
  }

  syncRevealButtonsLockUI() {
    const btnConfirm = this.els.capsuleStageContent.querySelector('#btn-confirm-reveal');
    const btnReturn = this.els.capsuleStageContent.querySelector('#btn-return-capsule');
    const btnRepeat = this.els.capsuleStageContent.querySelector('#btn-repeat-voice');
    if (!btnConfirm) return;

    btnConfirm.disabled = this.revealButtonsLocked;
    if (btnReturn) btnReturn.disabled = this.revealButtonsLocked;
    if (btnRepeat) btnRepeat.disabled = this.revealButtonsLocked;

    btnConfirm.textContent = this.revealButtonsLocked
      ? '🎤 กำลังขานหมายเลข... รอฟังให้จบก่อนน้า'
      : '✅ ตกลง / จับใบต่อไป';
  }

  highlightActiveChip(count) {
    const chips = this.els.presetChips.querySelectorAll('[data-preset]');
    chips.forEach((chip) => {
      chip.classList.toggle('active', Number(chip.dataset.preset) === count);
    });
  }

  updateAudioButtons() {
    this.els.btnVoice.textContent = this.voice.voiceEnabled ? '🎤 พากย์: เปิด' : '🙊 พากย์: ปิด';
    this.els.btnVoice.classList.toggle('muted', !this.voice.voiceEnabled);

    this.els.btnBgm.textContent = this.sound.bgmEnabled ? '🎵 เพลง: เปิด' : '🔇 เพลง: ปิด';
    this.els.btnBgm.classList.toggle('muted', !this.sound.bgmEnabled);

    this.els.btnSfx.textContent = this.sound.sfxEnabled ? '🔊 เสียง: เปิด' : '🔈 เสียง: ปิด';
    this.els.btnSfx.classList.toggle('muted', !this.sound.sfxEnabled);
  }

  renderUI(state, meta) {
    this.updateAudioButtons();

    const { phase, totalTickets, remainingTickets, drawnHistory, currentCapsule } = state;
    const remCount = remainingTickets.length;

    const { mood, speech } = getMascotMoodAndSpeech(state);
    this.currentMood = mood;
    this.els.mascotSpeech.textContent = speech;
    this.els.modalMascotSpeech.textContent = speech;

    // --- Voice-Synchronized Phase Transitions ---
    if (meta?.type === 'START_FILLING') {
      const runId = ++this.flowRunId;
      this.clearFlowTimers();
      this.voiceGateLocked = true;
      this.fillingPhysicsDone = false;
      this.fillingSpeechDone = !this.voice.voiceEnabled;

      this.machine.startPouringTickets(state.remainingTickets);
      this.voice.speakPouringStart(meta.count).then(() => {
        if (runId !== this.flowRunId) return;
        this.fillingSpeechDone = true;
        this.checkFillingCompletionGate(runId);
      });
    } else if (meta?.type === 'FILLING_DONE') {
      this.voice.speakFewLeftIfNeeded(remCount);
    } else if (meta?.type === 'START_CRANK' && meta.capsule) {
      const runId = ++this.flowRunId;
      this.clearFlowTimers();
      this.voiceGateLocked = true;

      // Spin continuously while Mochi speaks -> once speech finishes, spin 1.0s more & drop capsule!
      this.machine.startContinuousCrank(meta.capsule, state.remainingTickets);
      if (this.voice.voiceEnabled) {
        this.voice.speakCranking().then(() => {
          if (runId !== this.flowRunId || this.store.state.phase !== 'cranking') return;
          this.els.drawCtaLabel.textContent = 'กำลังปล่อยลูกแคปซูล...';
          this.machine.finishCrankTail(1.0);
        });
      } else {
        this.voice.speakCranking();
        this.mutedCrankTimer = setTimeout(() => {
          if (runId !== this.flowRunId || this.store.state.phase !== 'cranking') return;
          this.machine.finishCrankTail(1.0);
        }, 500);
      }
    } else if (meta?.type === 'CAPSULE_WAITING') {
      const runId = ++this.flowRunId;
      this.clearFlowTimers();
      this.capsuleTapLocked = Boolean(this.voice.voiceEnabled);
      this.voiceGateLocked = this.capsuleTapLocked;

      this.voice.speakCapsuleWaiting().then(() => {
        if (runId !== this.flowRunId || this.store.state.phase !== 'capsule_waiting') return;
        this.capsuleTapLocked = false;
        this.voiceGateLocked = false;
        this.syncWaitingCapsuleLockUI();
      });
    } else if (meta?.type === 'CAPSULE_OPENED' && meta.record) {
      const runId = ++this.flowRunId;
      this.clearFlowTimers();
      this.capsuleTapLocked = false;
      this.revealButtonsLocked = Boolean(this.voice.voiceEnabled);
      this.voiceGateLocked = this.revealButtonsLocked;

      this.voice.speakNumberRevealed(meta.record.number).then(() => {
        if (runId !== this.flowRunId || this.store.state.phase !== 'revealed') return;
        this.revealButtonsLocked = false;
        this.voiceGateLocked = false;
        this.syncRevealButtonsLockUI();
      });
    } else if (meta?.type === 'READY_NEXT') {
      this.voiceGateLocked = false;
      this.capsuleTapLocked = false;
      this.revealButtonsLocked = false;
      if (remCount > 0 && remCount <= 3) {
        this.voice.speakFewLeftIfNeeded(remCount);
      } else {
        this.voice.stopSpeaking();
      }
    } else if (meta?.type === 'RETURN_CAPSULE') {
      this.voiceGateLocked = false;
      this.capsuleTapLocked = false;
      this.revealButtonsLocked = false;
      this.machine.dropSingleReturnedCapsule(meta.number, remCount);
      this.voice.speakReturnToBox(meta.number);
    } else if (meta?.type === 'ALL_COMPLETED') {
      this.voiceGateLocked = false;
      this.sound.playGrandFinale();
      this.confetti.burstFinaleShower();
      this.voice.speakGrandFinale(totalTickets);
    } else if (meta?.type === 'RESET_TO_SETUP') {
      this.voiceGateLocked = false;
      this.capsuleTapLocked = false;
      this.revealButtonsLocked = false;
      this.voice.stopSpeaking();
    }

    this.renderMascotFigures();
    this.machine.setInteractive(phase === 'ready' && remCount > 0 && !this.voiceGateLocked);

    // 1. Update Counter & Progress Bar
    this.els.totalPill.textContent = `ทั้งหมด ${totalTickets} ใบ`;
    this.els.remainingCount.textContent = String(remCount);
    const pct = totalTickets > 0 ? Math.round((remCount / totalTickets) * 100) : 0;
    this.els.progressFill.style.width = `${pct}%`;

    // 2. Update Center Draw CTA Button
    if (phase === 'filling') {
      this.els.btnDraw.disabled = true;
      this.els.drawCtaLabel.textContent =
        this.fillingPhysicsDone && !this.fillingSpeechDone
          ? 'รอน้องโมจิพูดต้อนรับแป๊บนึงน้า...'
          : 'กำลังเทฉลากลงตู้...';
      this.els.drawHint.textContent = 'รอสักครู่น้า ลูกแคปซูลกำลังไหลลงโหลใส~';
    } else if (phase === 'cranking') {
      this.els.btnDraw.disabled = true;
      this.els.drawCtaLabel.textContent = 'กำลังหมุนสุ่ม...';
      this.els.drawHint.textContent =
        'รอฟังน้องโมจิพูดจบ แล้วอีก 1 วินาทีลูกแคปซูลจะเด้งออกมาจ้า!';
    } else if (phase === 'completed') {
      this.els.btnDraw.disabled = false;
      this.els.drawCtaLabel.textContent = 'เริ่มรอบใหม่ (จับครบแล้ว!)';
      this.els.drawHint.textContent = 'จับฉลากครบทุกใบในตู้เรียบร้อยแล้วจ้า 🎊';
    } else if (phase === 'setup') {
      this.els.btnDraw.disabled = false;
      this.els.drawCtaLabel.textContent = 'ตั้งค่าจำนวนฉลาก';
      this.els.drawHint.textContent = 'กำหนดจำนวนฉลากเพื่อเริ่มเกม';
    } else {
      this.els.btnDraw.disabled = remCount === 0;
      this.els.drawCtaLabel.textContent = 'หมุนจับฉลาก!';
      this.els.drawHint.textContent = 'กดปุ่มนี้ แตะก้านหมุนที่ตู้ หรือกด Spacebar เพื่อสุ่มทีละใบ';
    }

    // 3. Toggle Setup Modal
    if (phase === 'setup') {
      this.els.setupModal.classList.remove('hidden');
      this.els.inputTicketCount.value = String(this.setupDraftCount || totalTickets || 30);
      this.highlightActiveChip(Number(this.els.inputTicketCount.value));
    } else {
      this.els.setupModal.classList.add('hidden');
    }

    // 4. Render 2-Step Capsule Suspense / Reveal Modal
    if ((phase === 'capsule_waiting' || phase === 'revealed') && currentCapsule) {
      this.els.capsuleModal.classList.remove('hidden');
      const isRevealed = phase === 'revealed';
      this.els.modalMascotStage.classList.toggle('hidden', !isRevealed);
      this.els.capsuleModalStack.classList.toggle('is-revealed-layout', isRevealed);
      this.renderCapsuleModalContent(phase, currentCapsule);
    } else {
      this.els.capsuleModal.classList.add('hidden');
      this.els.modalMascotStage.classList.add('hidden');
      this.els.capsuleModalStack.classList.remove('is-revealed-layout');
    }

    // 5. Render Drawn History Board
    this.renderHistoryBoard(drawnHistory);
  }

  renderCapsuleModalContent(phase, capsule) {
    const theme =
      CAPSULE_THEMES.find((t) => t.key === capsule.colorKey) || getThemeForTicket(capsule.number);

    if (phase === 'capsule_waiting') {
      this.els.capsuleStageContent.innerHTML = `
        <div class="waiting-stage">
          <div class="stage-step-pill">✨ ลุ้นจังหวะที่ 2 — แกะแคปซูล! ✨</div>
          <button
            type="button"
            id="btn-open-capsule"
            class="giant-capsule-btn ${this.capsuleTapLocked ? 'capsule-locked' : ''}"
            style="--cap-glow: ${theme.glow}"
            aria-label="แตะเพื่อเปิดลูกแคปซูล"
            ${this.capsuleTapLocked ? 'disabled' : ''}
          >
            <svg viewBox="0 0 220 220" class="giant-capsule-svg">
              <circle cx="110" cy="110" r="92" fill="${theme.glow}" opacity="0.45"/>
              <path d="M 30 110 A 80 80 0 0 0 190 110 Z" fill="${theme.bottom}" stroke="#5A3846" stroke-width="5"/>
              <rect x="76" y="122" width="68" height="36" rx="8" fill="${theme.topLight}" stroke="#5A3846" stroke-width="3" transform="rotate(-6 110 140)"/>
              <text x="110" y="147" text-anchor="middle" font-size="22" font-weight="700" fill="#5A3846">?</text>
              <path d="M 30 110 A 80 80 0 0 1 190 110 Z" fill="${theme.top}" stroke="#5A3846" stroke-width="5"/>
              <rect x="26" y="101" width="168" height="18" rx="9" fill="${theme.rim}" stroke="#5A3846" stroke-width="4.2"/>
              <circle cx="110" cy="110" r="11" fill="#FFFDF7" stroke="#5A3846" stroke-width="3.8"/>
              <ellipse cx="78" cy="68" rx="22" ry="11" transform="rotate(-28 78 68)" fill="rgba(255,255,255,0.82)"/>
              <circle cx="60" cy="86" r="5.5" fill="rgba(255,255,255,0.82)"/>
            </svg>
          </button>
          <p id="waiting-prompt-badge" class="tap-capsule-prompt ${
            this.capsuleTapLocked ? 'prompt-waiting-voice' : ''
          }">
            ${
              this.capsuleTapLocked
                ? '🎤 รอน้องโมจิพูดชวนให้จบแป๊บนึงน้า...'
                : '👆 แตะที่ลูกแคปซูลเพื่อเปิดดูหมายเลข! <span class="hide-sm">(หรือกด Spacebar)</span>'
            }
          </p>
        </div>
      `;
    } else if (phase === 'revealed') {
      this.els.capsuleStageContent.innerHTML = `
        <div class="revealed-stage">
          <div class="popped-shell popped-top" aria-hidden="true">
            <svg viewBox="0 0 200 105" class="shell-half-svg">
              <path d="M 20 92 A 80 80 0 0 1 180 92 Z" fill="${theme.top}" stroke="#5A3846" stroke-width="5"/>
              <rect x="16" y="83" width="168" height="15" rx="7.5" fill="${theme.rim}" stroke="#5A3846" stroke-width="4"/>
              <ellipse cx="72" cy="52" rx="20" ry="10" transform="rotate(-25 72 52)" fill="rgba(255,255,255,0.8)"/>
            </svg>
          </div>

          <div class="ticket-reveal-card" style="--ticket-accent: ${theme.top}; --ticket-border: ${theme.rim}">
            <div class="ticket-top-row">
              <span class="ticket-order-badge">🎁 ฉลากลำดับที่ ${capsule.order}</span>
              <button
                type="button"
                id="btn-repeat-voice"
                class="repeat-voice-btn"
                title="ให้น้องโมจิขานหมายเลขซ้ำอีกครั้ง"
                ${this.revealButtonsLocked ? 'disabled' : ''}
              >
                🔊 ขานเลขซ้ำ
              </button>
            </div>
            <div class="ticket-subtitle">ได้ของขวัญหมายเลข</div>
            <div class="ticket-big-number">${capsule.number}</div>
            <div class="ticket-ribbons">✨ 🎀 ✨</div>

            <div class="reveal-actions">
              <button
                type="button"
                id="btn-confirm-reveal"
                class="primary-big-btn"
                ${this.revealButtonsLocked ? 'disabled' : ''}
              >
                ${
                  this.revealButtonsLocked
                    ? '🎤 กำลังขานหมายเลข... รอฟังให้จบก่อนน้า'
                    : '✅ ตกลง / จับใบต่อไป'
                }
              </button>
              <button
                type="button"
                id="btn-return-capsule"
                class="return-box-btn"
                ${this.revealButtonsLocked ? 'disabled' : ''}
              >
                ↩️ ใส่เลข ${capsule.number} กลับเข้าตู้ (สละสิทธิ์/ไม่อยู่)
              </button>
            </div>
          </div>

          <div class="popped-shell popped-bottom" aria-hidden="true">
            <svg viewBox="0 0 200 105" class="shell-half-svg">
              <path d="M 20 14 A 80 80 0 0 0 180 14 Z" fill="${theme.bottom}" stroke="#5A3846" stroke-width="5"/>
              <rect x="16" y="6" width="168" height="13" rx="6.5" fill="#FFFDF8" stroke="#5A3846" stroke-width="4"/>
            </svg>
          </div>
        </div>
      `;
    }
  }

  renderHistoryBoard(drawnHistory) {
    this.els.drawnCountBadge.textContent = `${drawnHistory.length} ใบ`;

    if (drawnHistory.length === 0) {
      this.els.latestDrawBox.classList.add('hidden');
      this.els.historyList.innerHTML = `
        <div class="history-empty">
          <div class="history-empty-icon">🎈</div>
          <p>ยังไม่มีเลขที่ถูกจับออกมา<br/>เริ่มหมุนตู้กาชาปองกันเลย!</p>
        </div>
      `;
      return;
    }

    const latest = drawnHistory[0];
    const latestTheme =
      CAPSULE_THEMES.find((t) => t.key === latest.colorKey) || getThemeForTicket(latest.number);

    this.els.latestDrawBox.classList.remove('hidden');
    this.els.latestDrawBox.innerHTML = `
      <div class="latest-badge-wrap" style="--latest-bg: ${latestTheme.topLight}; --latest-rim: ${latestTheme.rim}">
        <div class="latest-meta">
          <span class="latest-tag">🌟 ใบล่าสุด (#${latest.order})</span>
        </div>
        <div class="latest-num">${latest.number}</div>
      </div>
    `;

    this.els.historyList.innerHTML = `
      <div class="history-chips-grid">
        ${drawnHistory
          .map((item) => {
            const t =
              CAPSULE_THEMES.find((c) => c.key === item.colorKey) || getThemeForTicket(item.number);
            return `
              <div class="history-chip" style="--chip-dot: ${t.top}; --chip-bg: ${t.bottom}">
                <span class="chip-order">#${item.order}</span>
                <span class="chip-dot"></span>
                <span class="chip-number">${item.number}</span>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const appEl = document.getElementById('app');
  if (appEl) {
    new KawaiiGachaponApp(appEl);
  }
  // Register Offline Service Worker when served over HTTPS or localhost
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
