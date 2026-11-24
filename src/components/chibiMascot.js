const EMBEDDED_SPRITES =
  typeof window !== 'undefined' && window.__EMBEDDED_SPRITES__ ? window.__EMBEDDED_SPRITES__ : null;

export const MASCOT_SPRITES = {
  idleClosed: EMBEDDED_SPRITES?.idle_closed || './assets/mascot/idle_closed.webp',
  talkOpen: EMBEDDED_SPRITES?.talk_open || './assets/mascot/talk_open.webp',
  starryClosed: EMBEDDED_SPRITES?.starry_closed || './assets/mascot/starry_closed.webp',
  starryOpen: EMBEDDED_SPRITES?.starry_open || './assets/mascot/starry_open.webp',
  cheeringClosed: EMBEDDED_SPRITES?.cheering_closed || './assets/mascot/cheering_closed.webp',
  cheeringOpen: EMBEDDED_SPRITES?.cheering_open || './assets/mascot/cheering_open.webp',
};

let preloaded = false;
const preloadedImages = [];

export function preloadMascotSprites() {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = true;
  Object.values(MASCOT_SPRITES).forEach((src) => {
    const img = new Image();
    img.src = src;
    preloadedImages.push(img);
  });
}

const SPEECH_BY_PHASE = {
  setup: 'ใส่จำนวนฉลากของขวัญที่จะสร้างลงตู้ได้เลยน้า~ ✨',
  filling: 'ว้าวว~ ลูกแคปซูลกำลังไหลลงโหลเต็มเลย! 🎀',
  ready: 'กดปุ่มหมุนตู้ (หรือแตะก้านหมุน) เพื่อจับฉลากทีละใบเลย! 🎁',
  ready_few: 'ตื่นเต้นจังเลย! เหลือฉลากอีกแค่ไม่กี่ใบสุดท้ายแล้ว~ 💓',
  cranking: 'หมุนติ้วๆ เลย~ จะได้เลขอะไรน้าา... 🌟',
  capsule_waiting: 'แคปซูลหล่นออกมาแล้ว! แตะที่ลูกแคปซูลเพื่อแกะดูเลขเร็ว~ 🎊',
  revealed: 'ทาด๊าา~! ยินดีกับเจ้าของหมายเลขนี้ด้วยนะค้าา 🎉',
  completed: 'เย้~! จับฉลากครบทุกใบหมดตู้เรียบร้อยแล้วจ้า 🥳💖',
};

export function getMascotMoodAndSpeech(state) {
  const { phase, remainingTickets, currentCapsule } = state;
  if (phase === 'setup') {
    return { mood: 'happy', speech: SPEECH_BY_PHASE.setup };
  }
  if (phase === 'filling') {
    return { mood: 'excited', speech: SPEECH_BY_PHASE.filling };
  }
  if (phase === 'cranking') {
    return { mood: 'starry', speech: SPEECH_BY_PHASE.cranking };
  }
  if (phase === 'capsule_waiting') {
    return { mood: 'starry', speech: SPEECH_BY_PHASE.capsule_waiting };
  }
  if (phase === 'revealed') {
    const numText = currentCapsule ? `หมายเลข #${currentCapsule.number}! ` : '';
    return {
      mood: 'cheering',
      speech: `ทาด๊าา~! ได้ ${numText}ยินดีด้วยนะค้าา 🎉`,
    };
  }
  if (phase === 'completed') {
    return { mood: 'cheering', speech: SPEECH_BY_PHASE.completed };
  }
  if (remainingTickets.length > 0 && remainingTickets.length <= 3) {
    return { mood: 'excited', speech: SPEECH_BY_PHASE.ready_few };
  }
  return { mood: 'idle', speech: SPEECH_BY_PHASE.ready };
}

function getSpritePairForMood(mood) {
  if (mood === 'cheering') {
    return {
      closedSrc: MASCOT_SPRITES.cheeringClosed,
      openSrc: MASCOT_SPRITES.cheeringOpen,
      restOpen: true, // Keep her big joyful >▽< smile even after finishing cheering speech!
    };
  }
  if (mood === 'starry' || mood === 'excited') {
    return {
      closedSrc: MASCOT_SPRITES.starryClosed,
      openSrc: MASCOT_SPRITES.starryOpen,
      restOpen: false,
    };
  }
  return {
    closedSrc: MASCOT_SPRITES.idleClosed,
    openSrc: MASCOT_SPRITES.talkOpen,
    restOpen: false,
  };
}

/**
 * Updates or mounts the 2-layer Moe Chibi Schoolgirl sprite inside containerEl
 * without recreating <img> nodes when only speaking/mood toggles (zero flicker!).
 */
export function mountOrUpdateMascotFigure(
  containerEl,
  mood = 'idle',
  { isSpeaking = false, variant = 'full' } = {}
) {
  if (!containerEl) return;
  preloadMascotSprites();

  const { closedSrc, openSrc, restOpen } = getSpritePairForMood(mood);

  let stage = containerEl.querySelector('.moe-sprite-stage');
  if (!stage) {
    containerEl.innerHTML = `
      <div class="moe-sprite-stage moe-variant-${variant}">
        <div class="moe-ground-shadow" aria-hidden="true"></div>
        <div class="moe-body-mover">
          <img class="moe-layer moe-layer-closed" alt="พิธีกรน้องโมจิ" draggable="false" />
          <img class="moe-layer moe-layer-open" alt="" aria-hidden="true" draggable="false" />
        </div>
        <div class="moe-emote-badge" aria-hidden="true"></div>
      </div>
    `;
    stage = containerEl.querySelector('.moe-sprite-stage');
  }

  stage.className = `moe-sprite-stage moe-variant-${variant} moe-mood-${mood} ${
    isSpeaking ? 'moe-is-speaking' : ''
  } ${!isSpeaking && restOpen ? 'moe-rest-open' : ''}`;

  const imgClosed = stage.querySelector('.moe-layer-closed');
  const imgOpen = stage.querySelector('.moe-layer-open');
  const emoteEl = stage.querySelector('.moe-emote-badge');

  if (imgClosed.getAttribute('src') !== closedSrc) {
    imgClosed.setAttribute('src', closedSrc);
  }
  if (imgOpen.getAttribute('src') !== openSrc) {
    imgOpen.setAttribute('src', openSrc);
  }

  if (emoteEl) {
    if (mood === 'cheering') {
      emoteEl.textContent = '🎉';
    } else if (mood === 'starry' || mood === 'excited') {
      emoteEl.textContent = '✨';
    } else if (isSpeaking) {
      emoteEl.textContent = '💬';
    } else {
      emoteEl.textContent = '';
    }
  }
}
