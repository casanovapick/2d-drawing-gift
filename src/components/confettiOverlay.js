const CONFETTI_COLORS = [
  '#FF8FB8',
  '#75C4FF',
  '#6EE5BD',
  '#FFE066',
  '#C296FF',
  '#FFB38A',
  '#FFFFFF',
];

export class ConfettiOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.rafId = null;
    this.lastTime = performance.now();

    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  handleResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
  }

  burstCenter(count = 85) {
    const cx = this.width * 0.5;
    const cy = this.height * 0.46;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 220 + Math.random() * 540;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 30,
        y: cy + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 220,
        w: 8 + Math.random() * 8,
        h: 6 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 12,
        tilt: Math.random() * Math.PI,
        vTilt: 4 + Math.random() * 6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        shape: i % 5 === 0 ? 'star' : 'ribbon',
        life: 1,
        decay: 0.42 + Math.random() * 0.35,
      });
    }

    this.ensureLoop();
  }

  burstFinaleShower() {
    this.burstCenter(100);
    setTimeout(() => {
      for (let i = 0; i < 80; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: -20 - Math.random() * 120,
          vx: (Math.random() - 0.5) * 140,
          vy: 180 + Math.random() * 240,
          w: 9 + Math.random() * 7,
          h: 6 + Math.random() * 6,
          rot: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 8,
          tilt: Math.random() * Math.PI,
          vTilt: 3 + Math.random() * 5,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          shape: i % 4 === 0 ? 'star' : 'ribbon',
          life: 1,
          decay: 0.28 + Math.random() * 0.22,
        });
      }
      this.ensureLoop();
    }, 320);
  }

  ensureLoop() {
    if (this.rafId) return;
    this.lastTime = performance.now();
    const step = (now) => {
      const dt = Math.min(0.035, Math.max(0.001, (now - this.lastTime) / 1000));
      this.lastTime = now;
      this.updateAndDraw(dt);
      if (this.particles.length > 0) {
        this.rafId = requestAnimationFrame(step);
      } else {
        this.rafId = null;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    };
    this.rafId = requestAnimationFrame(step);
  }

  updateAndDraw(dt) {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.width, this.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vy += 640 * dt;
      p.vx *= 0.985;
      p.vy *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vRot * dt;
      p.tilt += p.vTilt * dt;
      p.life -= p.decay * dt;

      if (p.life <= 0 || p.y > this.height + 40) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 1.4);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;

      if (p.shape === 'star') {
        const r = p.w * 0.65;
        ctx.beginPath();
        for (let s = 0; s < 5; s++) {
          const a1 = (s * Math.PI * 2) / 5 - Math.PI / 2;
          const a2 = a1 + Math.PI / 5;
          ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
          ctx.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        const scaleY = Math.cos(p.tilt);
        ctx.scale(1, scaleY);
        ctx.beginPath();
        ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 2.5);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.restore();
  }
}
