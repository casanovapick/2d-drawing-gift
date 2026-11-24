const STORAGE_KEY = 'kawaii_gachapon_party_v1';

export const CAPSULE_THEMES = [
  {
    key: 'sakura',
    name: 'ชมพูซากุระ',
    top: '#FF8FB8',
    topLight: '#FFD1E3',
    topDark: '#E86896',
    bottom: '#FFF7FA',
    rim: '#FF6B9E',
    accent: '#D9437A',
    glow: 'rgba(255, 130, 178, 0.55)',
  },
  {
    key: 'sky',
    name: 'ฟ้าปุยเมฆ',
    top: '#75C4FF',
    topLight: '#C7E8FF',
    topDark: '#4AA3EB',
    bottom: '#F4FAFF',
    rim: '#4CA6F5',
    accent: '#2378C4',
    glow: 'rgba(117, 196, 255, 0.55)',
  },
  {
    key: 'mint',
    name: 'เขียวมิ้นต์',
    top: '#6EE5BD',
    topLight: '#C4F9E6',
    topDark: '#42C499',
    bottom: '#F3FFF9',
    rim: '#40C99B',
    accent: '#1E9970',
    glow: 'rgba(110, 229, 189, 0.55)',
  },
  {
    key: 'lemon',
    name: 'เหลืองเลมอน',
    top: '#FFDC6B',
    topLight: '#FFF3BF',
    topDark: '#ECC038',
    bottom: '#FFFEF4',
    rim: '#F5C227',
    accent: '#C28B00',
    glow: 'rgba(255, 220, 107, 0.6)',
  },
  {
    key: 'lavender',
    name: 'ม่วงลาเวนเดอร์',
    top: '#C296FF',
    topLight: '#E8D6FF',
    topDark: '#9D6BE8',
    bottom: '#FAF6FF',
    rim: '#A36BFF',
    accent: '#7338D4',
    glow: 'rgba(194, 150, 255, 0.55)',
  },
];

export function getThemeForTicket(ticketNumber) {
  // Deterministic shuffled mapping so colors feel nicely mixed yet consistent per ticket
  const index = ((ticketNumber * 7 + 3) % CAPSULE_THEMES.length + CAPSULE_THEMES.length) % CAPSULE_THEMES.length;
  return CAPSULE_THEMES[index];
}

const DEFAULT_STATE = {
  phase: 'setup', // 'setup' | 'filling' | 'ready' | 'cranking' | 'capsule_waiting' | 'revealed' | 'completed'
  totalTickets: 30,
  remainingTickets: [],
  drawnHistory: [], // [{ number, colorKey, order, timestamp }]
  currentCapsule: null, // { number, colorKey, order }
};

export class GameStore {
  constructor() {
    this.listeners = new Set();
    this.state = this.loadState();
  }

  loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_STATE };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.totalTickets !== 'number') {
        return { ...DEFAULT_STATE };
      }

      // Normalize transient animations on reload so the player never gets stuck
      let phase = parsed.phase || 'setup';
      if (phase === 'filling') {
        phase = parsed.remainingTickets?.length > 0 ? 'ready' : 'setup';
      } else if (phase === 'cranking') {
        phase = parsed.currentCapsule ? 'capsule_waiting' : 'ready';
      }

      return {
        phase,
        totalTickets: Math.min(500, Math.max(1, parsed.totalTickets || 30)),
        remainingTickets: Array.isArray(parsed.remainingTickets) ? parsed.remainingTickets : [],
        drawnHistory: Array.isArray(parsed.drawnHistory) ? parsed.drawnHistory : [],
        currentCapsule: parsed.currentCapsule || null,
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore storage quota errors
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setState(patch, eventMeta = null) {
    this.state = { ...this.state, ...patch };
    this.saveState();
    for (const listener of this.listeners) {
      listener(this.state, eventMeta);
    }
  }

  startGame(count) {
    const cleanCount = Math.min(500, Math.max(1, Math.floor(Number(count) || 1)));
    const pool = [];
    for (let i = 1; i <= cleanCount; i++) {
      pool.push(i);
    }
    this.setState(
      {
        phase: 'filling',
        totalTickets: cleanCount,
        remainingTickets: pool,
        drawnHistory: [],
        currentCapsule: null,
      },
      { type: 'START_FILLING', count: cleanCount }
    );
  }

  finishFilling() {
    if (this.state.phase === 'filling') {
      this.setState({ phase: 'ready' }, { type: 'FILLING_DONE' });
    }
  }

  startCrankDraw() {
    if (this.state.phase !== 'ready' || this.state.remainingTickets.length === 0) {
      return null;
    }
    const pool = [...this.state.remainingTickets];
    // Cryptographically strong random draw when available
    let randomIndex;
    if (window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      window.crypto.getRandomValues(arr);
      randomIndex = arr[0] % pool.length;
    } else {
      randomIndex = Math.floor(Math.random() * pool.length);
    }

    const [pickedNumber] = pool.splice(randomIndex, 1);
    const theme = getThemeForTicket(pickedNumber);
    const capsule = {
      number: pickedNumber,
      colorKey: theme.key,
      order: this.state.drawnHistory.length + 1,
    };

    this.setState(
      {
        phase: 'cranking',
        remainingTickets: pool,
        currentCapsule: capsule,
      },
      { type: 'START_CRANK', capsule }
    );
    return capsule;
  }

  onCapsuleDroppedToStage() {
    if (this.state.phase === 'cranking' && this.state.currentCapsule) {
      this.setState({ phase: 'capsule_waiting' }, { type: 'CAPSULE_WAITING' });
    }
  }

  openWaitingCapsule() {
    if (this.state.phase !== 'capsule_waiting' || !this.state.currentCapsule) {
      return null;
    }
    const capsule = this.state.currentCapsule;
    const record = {
      number: capsule.number,
      colorKey: capsule.colorKey,
      order: this.state.drawnHistory.length + 1,
      timestamp: Date.now(),
    };
    const nextHistory = [record, ...this.state.drawnHistory];
    this.setState(
      {
        phase: 'revealed',
        drawnHistory: nextHistory,
      },
      { type: 'CAPSULE_OPENED', record }
    );
    return record;
  }

  confirmRevealedCapsule() {
    if (this.state.phase !== 'revealed') return;
    const isFinished = this.state.remainingTickets.length === 0;
    this.setState(
      {
        phase: isFinished ? 'completed' : 'ready',
        currentCapsule: null,
      },
      { type: isFinished ? 'ALL_COMPLETED' : 'READY_NEXT' }
    );
  }

  returnRevealedCapsuleToBox() {
    if (this.state.phase !== 'revealed' || !this.state.currentCapsule) return;
    const returnedNum = this.state.currentCapsule.number;
    const returnedColor = this.state.currentCapsule.colorKey;

    // Remove the latest matching entry from history and put number back into remainingTickets
    const nextHistory = [...this.state.drawnHistory];
    const idx = nextHistory.findIndex((item) => item.number === returnedNum);
    if (idx !== -1) {
      nextHistory.splice(idx, 1);
    }
    // Re-number sequential order cleanly from oldest to newest
    const total = nextHistory.length;
    const reindexed = nextHistory.map((item, i) => ({
      ...item,
      order: total - i,
    }));

    const nextPool = [...this.state.remainingTickets, returnedNum];
    this.setState(
      {
        phase: 'ready',
        remainingTickets: nextPool,
        drawnHistory: reindexed,
        currentCapsule: null,
      },
      { type: 'RETURN_CAPSULE', number: returnedNum, colorKey: returnedColor }
    );
  }

  openSetupReset() {
    this.setState(
      {
        phase: 'setup',
        remainingTickets: [],
        drawnHistory: [],
        currentCapsule: null,
      },
      { type: 'RESET_TO_SETUP' }
    );
  }
}
