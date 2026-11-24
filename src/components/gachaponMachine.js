import { CAPSULE_THEMES, getThemeForTicket } from '../state/gameStore.js';

const MAX_VISUAL_CAPSULES = 100;
const LINE_COLOR = '#5A3846';

function drawRoundedRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export class GachaponMachine {
  constructor(canvas, { sound, onCrankClick, onFillingComplete, onCrankComplete }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sound = sound;
    this.onCrankClick = onCrankClick;
    this.onFillingComplete = onFillingComplete;
    this.onCrankComplete = onCrankComplete;

    this.width = 420;
    this.height = 520;
    this.zoomScale = 1;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.balls = [];
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.isFilling = false;
    this.fillDoneTimeout = null;

    this.crankAnim = {
      active: false,
      mode: 'looping', // 'looping' while mascot speaks -> 'tail' for final 1.0s spin & drop
      tailElapsed: 0,
      tailDuration: 1.0,
      angle: 0,
      tickTimer: 0,
      tickCount: 0,
      ejectTheme: CAPSULE_THEMES[0],
    };

    this.lidOpenAmount = 0; // 0..1 when pouring capsules
    this.sparkles = [];
    this.hoveredInteractive = false;
    this.canInteract = false;

    this.rafId = null;
    this.lastTime = performance.now();

    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);

    if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas.parentElement);
    }

    this.resize();
    this.startLoop();
  }

  getGeometry() {
    const w = this.width;
    const h = this.height;
    const cx = w * 0.5;
    const globeR = Math.min(w * 0.37, h * 0.285);
    const globeCy = h * 0.365;
    const crankCx = cx;
    const crankCy = globeCy + globeR + h * 0.135;
    const crankR = globeR * 0.29;
    const chuteCx = cx;
    const chuteCy = globeCy + globeR + h * 0.295;
    return { w, h, cx, globeCy, globeR, crankCx, crankCy, crankR, chuteCx, chuteCy };
  }

  computeBallRadius(visualCount, globeR) {
    if (visualCount <= 10) return globeR * 0.21;
    if (visualCount <= 25) return globeR * 0.165;
    if (visualCount <= 50) return globeR * 0.132;
    if (visualCount <= 75) return globeR * 0.112;
    return globeR * 0.098;
  }

  setZoomScale(scale) {
    const next = Math.max(0.25, Math.min(4, Number(scale) || 1));
    if (Math.abs(this.zoomScale - next) > 0.001) {
      this.zoomScale = next;
      this.resize();
    }
  }

  resize(customWidth, customHeight) {
    const layoutWidth = this.canvas.parentElement?.clientWidth || 400;
    this.width = customWidth || Math.max(300, Math.min(460, layoutWidth));
    this.height = customHeight || Math.round(this.width * 1.22);
    const baseDpr = window.devicePixelRatio || 1;
    this.dpr = Math.min(4, baseDpr * Math.max(1, this.zoomScale));

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    const { globeR } = this.getGeometry();
    const targetR = this.computeBallRadius(Math.max(this.balls.length, 1), globeR);
    for (const b of this.balls) {
      b.r = targetR;
    }
  }

  setInteractive(canInteract) {
    this.canInteract = canInteract;
    if (!canInteract) {
      this.canvas.style.cursor = 'default';
    }
  }

  getLogicalPointerPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: -999, y: -999 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * this.width,
      y: ((e.clientY - rect.top) / rect.height) * this.height,
    };
  }

  handlePointerMove(e) {
    if (!this.canInteract) {
      this.hoveredInteractive = false;
      this.canvas.style.cursor = 'default';
      return;
    }
    const { x, y } = this.getLogicalPointerPos(e);
    const { crankCx, crankCy, crankR } = this.getGeometry();
    const dist = Math.hypot(x - crankCx, y - crankCy);
    this.hoveredInteractive = dist <= crankR * 1.45;
    this.canvas.style.cursor = this.hoveredInteractive ? 'pointer' : 'default';
  }

  handlePointerDown(e) {
    if (!this.canInteract) return;
    const { x, y } = this.getLogicalPointerPos(e);
    const { crankCx, crankCy, crankR } = this.getGeometry();
    const dist = Math.hypot(x - crankCx, y - crankCy);
    if (dist <= crankR * 1.55 && this.onCrankClick) {
      this.onCrankClick();
    }
  }

  syncTicketsInstant(remainingTickets) {
    if (this.fillDoneTimeout) {
      clearTimeout(this.fillDoneTimeout);
      this.fillDoneTimeout = null;
    }
    this.crankAnim.active = false;
    this.crankAnim.angle = 0;
    this.spawnQueue = [];
    this.isFilling = false;
    this.lidOpenAmount = 0;
    const visualTickets = remainingTickets.slice(0, MAX_VISUAL_CAPSULES);
    const { cx, globeCy, globeR } = this.getGeometry();
    const r = this.computeBallRadius(visualTickets.length, globeR);

    this.balls = visualTickets.map((ticketNum, i) => {
      const angle = i * 2.39996; // Golden angle spiral inside dome
      const dist = Math.min(globeR - r - 4, Math.sqrt(i + 0.5) * r * 1.45);
      return {
        id: ticketNum,
        x: cx + Math.cos(angle) * dist * 0.85,
        y: globeCy + globeR * 0.22 + (Math.sin(angle) * dist * 0.55),
        vx: (Math.random() - 0.5) * 20,
        vy: 0,
        r,
        angle: (Math.random() - 0.5) * Math.PI,
        vAngle: 0,
        theme: getThemeForTicket(ticketNum),
      };
    });
  }

  startPouringTickets(remainingTickets) {
    if (this.fillDoneTimeout) {
      clearTimeout(this.fillDoneTimeout);
      this.fillDoneTimeout = null;
    }
    this.balls = [];
    const visualTickets = remainingTickets.slice(0, MAX_VISUAL_CAPSULES);
    const { globeR } = this.getGeometry();
    const targetR = this.computeBallRadius(visualTickets.length, globeR);

    this.spawnQueue = visualTickets.map((num) => ({
      id: num,
      r: targetR,
      theme: getThemeForTicket(num),
    }));
    this.isFilling = true;
    this.spawnTimer = 0;
    this.lidOpenAmount = 1;
  }

  startContinuousCrank(pickedCapsule, remainingAfterPick) {
    const theme =
      CAPSULE_THEMES.find((t) => t.key === pickedCapsule.colorKey) || getThemeForTicket(pickedCapsule.number);

    this.crankAnim = {
      active: true,
      mode: 'looping',
      tailElapsed: 0,
      tailDuration: 1.0,
      angle: 0,
      tickTimer: 0,
      tickCount: 0,
      ejectTheme: theme,
    };

    this.pendingPickRemoval = {
      number: pickedCapsule.number,
      desiredVisualCount: Math.min(MAX_VISUAL_CAPSULES, remainingAfterPick.length),
    };

    const { globeR } = this.getGeometry();
    const nextR = this.computeBallRadius(Math.max(1, this.balls.length), globeR);
    for (const b of this.balls) {
      b.r = nextR;
      b.vy = -(250 + Math.random() * 230);
      b.vx = (Math.random() - 0.5) * 360;
      b.vAngle = (Math.random() - 0.5) * 10;
    }

    this.sound?.playCrankTick(0);
    this.emitSparkles(this.width * 0.5, this.height * 0.36, 12);
  }

  finishCrankTail(tailSeconds = 1.0) {
    if (!this.crankAnim.active) return;
    this.crankAnim.mode = 'tail';
    this.crankAnim.tailElapsed = 0;
    this.crankAnim.tailDuration = Math.max(0.2, tailSeconds);

    // Remove picked capsule from dome right as the 1-second final drop begins
    if (this.pendingPickRemoval) {
      const { number, desiredVisualCount } = this.pendingPickRemoval;
      this.pendingPickRemoval = null;
      if (this.balls.length > desiredVisualCount) {
        const idx = this.balls.findIndex((b) => b.id === number);
        if (idx !== -1) {
          this.balls.splice(idx, 1);
        } else {
          this.balls.pop();
        }
      }
      const { globeR } = this.getGeometry();
      const nextR = this.computeBallRadius(Math.max(1, this.balls.length), globeR);
      for (const b of this.balls) {
        b.r = nextR;
        b.vy = -(220 + Math.random() * 180);
        b.vx = (Math.random() - 0.5) * 320;
      }
    }

    this.sound?.playCapsuleChuteDrop();
  }

  dropSingleReturnedCapsule(ticketNumber, totalRemainingCount) {
    const desiredVisual = Math.min(MAX_VISUAL_CAPSULES, totalRemainingCount);
    const { cx, globeCy, globeR } = this.getGeometry();
    const nextR = this.computeBallRadius(desiredVisual, globeR);

    for (const b of this.balls) {
      b.r = nextR;
    }

    if (this.balls.length < desiredVisual) {
      this.lidOpenAmount = 0.9;
      this.balls.push({
        id: ticketNumber,
        x: cx + (Math.random() - 0.5) * 18,
        y: globeCy - globeR * 0.78,
        vx: (Math.random() - 0.5) * 90,
        vy: 140,
        r: nextR,
        angle: (Math.random() - 0.5) * 1.5,
        vAngle: (Math.random() - 0.5) * 5,
        theme: getThemeForTicket(ticketNumber),
      });
    }
    this.emitSparkles(cx, globeCy - globeR * 0.75, 10);
  }

  emitSparkles(x, y, count = 10) {
    const colors = ['#FF8FB8', '#FFE066', '#75C4FF', '#6EE5BD', '#C296FF'];
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 45 + Math.random() * 120;
      this.sparkles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 30,
        size: 4 + Math.random() * 6,
        life: 1,
        decay: 1.1 + Math.random() * 0.8,
        color: colors[i % colors.length],
      });
    }
  }

  startLoop() {
    const tick = (now) => {
      const dt = Math.min(0.033, Math.max(0.001, (now - this.lastTime) / 1000));
      this.lastTime = now;
      this.update(dt);
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
  }

  update(dt) {
    const { cx, globeCy, globeR, chuteCx, chuteCy } = this.getGeometry();

    // Handle pouring queue
    if (this.isFilling) {
      this.spawnTimer += dt;
      // Adaptive pour speed: finish pouring within ~1.4s even for 100 capsules
      const batchRate = this.spawnQueue.length > 45 ? 0.014 : 0.032;
      while (this.spawnQueue.length > 0 && this.spawnTimer >= batchRate) {
        this.spawnTimer -= batchRate;
        const item = this.spawnQueue.shift();
        this.balls.push({
          id: item.id,
          x: cx + (Math.random() - 0.5) * (globeR * 0.42),
          y: globeCy - globeR * 0.78,
          vx: (Math.random() - 0.5) * 140,
          vy: 150 + Math.random() * 90,
          r: item.r,
          angle: (Math.random() - 0.5) * Math.PI,
          vAngle: (Math.random() - 0.5) * 6,
          theme: item.theme,
        });
        this.sound?.playCapsuleDrop(this.balls.length);
      }

      if (this.spawnQueue.length === 0) {
        this.isFilling = false;
        this.fillDoneTimeout = setTimeout(() => {
          this.fillDoneTimeout = null;
          this.onFillingComplete?.();
        }, 420);
      }
    } else if (this.lidOpenAmount > 0) {
      this.lidOpenAmount = Math.max(0, this.lidOpenAmount - dt * 2.6);
    }

    // Handle continuous crank spin during speech + final 1.0s tail spin
    if (this.crankAnim.active) {
      this.crankAnim.tickTimer += dt;
      if (this.crankAnim.tickTimer >= 0.16) {
        this.crankAnim.tickTimer -= 0.16;
        this.crankAnim.tickCount++;
        if (this.crankAnim.mode === 'looping' || this.crankAnim.tailElapsed < this.crankAnim.tailDuration * 0.55) {
          this.sound?.playCrankTick(this.crankAnim.tickCount);
        }
      }

      if (this.crankAnim.mode === 'looping') {
        this.crankAnim.angle = (this.crankAnim.angle + dt * Math.PI * 2.6) % (Math.PI * 2);

        // Keep capsules energetically tumbling inside the globe while Mochi speaks
        if (Math.random() < 0.55) {
          for (const b of this.balls) {
            const dx = b.x - cx;
            const dy = b.y - globeCy;
            b.vx += (-dy * 1.85 + (Math.random() - 0.5) * 230) * dt * 7.5;
            b.vy += (dx * 1.85 - 155) * dt * 7.5;
          }
        }
      } else {
        // 'tail' mode: exact 1.0 second post-speech countdown before displaying capsule modal
        this.crankAnim.tailElapsed += dt;
        const tailProgress = Math.min(1, this.crankAnim.tailElapsed / this.crankAnim.tailDuration);
        const speedMul = 1 - tailProgress * 0.72;
        this.crankAnim.angle = (this.crankAnim.angle + dt * Math.PI * 2.8 * speedMul) % (Math.PI * 2);

        if (tailProgress < 0.45 && Math.random() < 0.5) {
          for (const b of this.balls) {
            const dx = b.x - cx;
            const dy = b.y - globeCy;
            b.vx += (-dy * 1.6 + (Math.random() - 0.5) * 180) * dt * 6;
            b.vy += (dx * 1.6 - 120) * dt * 6;
          }
        }

        if (tailProgress >= 0.52 && tailProgress - dt / this.crankAnim.tailDuration < 0.52) {
          this.emitSparkles(chuteCx, chuteCy, 16);
        }

        if (tailProgress >= 1) {
          this.crankAnim.active = false;
          this.crankAnim.angle = 0;
          this.onCrankComplete?.();
        }
      }
    }

    // 2D Circle Physics inside Dome (2 sub-steps for crisp stability)
    const subSteps = 2;
    const subDt = dt / subSteps;
    const gravity = 690;
    const innerBoundR = globeR - 5;

    for (let s = 0; s < subSteps; s++) {
      for (const b of this.balls) {
        b.vy += gravity * subDt;
        b.vx *= 0.992;
        b.vy *= 0.992;
        b.x += b.vx * subDt;
        b.y += b.vy * subDt;
        b.angle += b.vAngle * subDt;
        b.vAngle *= 0.96;

        // Circular glass wall constraint
        const dx = b.x - cx;
        const dy = b.y - globeCy;
        const dist = Math.hypot(dx, dy);
        const maxDist = innerBoundR - b.r;
        if (dist > maxDist && dist > 0.0001) {
          const nx = dx / dist;
          const ny = dy / dist;
          b.x = cx + nx * maxDist;
          b.y = globeCy + ny * maxDist;

          const vn = b.vx * nx + b.vy * ny;
          if (vn > 0) {
            const restitution = 0.42;
            b.vx -= (1 + restitution) * vn * nx;
            b.vy -= (1 + restitution) * vn * ny;
            // Slight rolling spin from tangential velocity
            const vt = -b.vx * ny + b.vy * nx;
            b.vAngle = vt * 0.025;
          }
        }
      }

      // Pairwise ball-ball collision resolution
      const len = this.balls.length;
      for (let i = 0; i < len; i++) {
        const a = this.balls[i];
        for (let j = i + 1; j < len; j++) {
          const b = this.balls[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minDist = a.r + b.r;
          const distSq = dx * dx + dy * dy;
          if (distSq < minDist * minDist && distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = (minDist - dist) * 0.5;

            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;

            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const velAlongNormal = rvx * nx + rvy * ny;
            if (velAlongNormal < 0) {
              const bounce = 0.36;
              const impulse = -(1 + bounce) * velAlongNormal * 0.5;
              a.vx -= impulse * nx;
              a.vy -= impulse * ny;
              b.vx += impulse * nx;
              b.vy += impulse * ny;
            }
          }
        }
      }
    }

    // Update sparkles
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const sp = this.sparkles[i];
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.life -= sp.decay * dt;
      if (sp.life <= 0) {
        this.sparkles.splice(i, 1);
      }
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.width, this.height);

    const geo = this.getGeometry();
    const { cx, globeCy, globeR, crankCx, crankCy, crankR, chuteCx, chuteCy } = geo;

    // 1. Soft Ground Shadow
    ctx.save();
    ctx.fillStyle = 'rgba(138, 86, 115, 0.16)';
    ctx.beginPath();
    ctx.ellipse(cx, chuteCy + globeR * 0.44, globeR * 0.92, globeR * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Machine Base Body (Strawberry Pastel Anime Trapezoid)
    this.drawMachineBase(ctx, geo);

    // 3. Glass Globe Backdrop
    ctx.save();
    const domeGrad = ctx.createRadialGradient(
      cx - globeR * 0.25,
      globeCy - globeR * 0.3,
      globeR * 0.1,
      cx,
      globeCy,
      globeR
    );
    domeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    domeGrad.addColorStop(0.65, 'rgba(235, 248, 255, 0.58)');
    domeGrad.addColorStop(1, 'rgba(206, 234, 255, 0.72)');

    ctx.beginPath();
    ctx.arc(cx, globeCy, globeR, 0, Math.PI * 2);
    ctx.fillStyle = domeGrad;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();
    ctx.restore();

    // 4. Clipped Capsules Inside the Globe
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, globeCy, globeR - 2.5, 0, Math.PI * 2);
    ctx.clip();

    if (this.balls.length === 0 && !this.isFilling) {
      // Cute subtle empty-dome watermark
      ctx.fillStyle = 'rgba(140, 105, 128, 0.38)';
      ctx.font = '600 15px "Mitr", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✨ โหลว่างแล้วจ้า ✨', cx, globeCy + 6);
    }

    for (const b of this.balls) {
      this.drawCapsuleBall(ctx, b.x, b.y, b.r, b.angle, b.theme);
    }
    ctx.restore();

    // 5. Glass Specular Shine Overlays (makes capsules sit convincingly behind curved acrylic!)
    this.drawGlassReflections(ctx, cx, globeCy, globeR);

    // 6. Top Decorative Cap & Ribbon Finial (tilts open slightly when pouring!)
    this.drawTopLid(ctx, cx, globeCy, globeR);

    // 7. Collar Ring between Globe & Base
    this.drawCollar(ctx, cx, globeCy + globeR * 0.89, globeR);

    // 8. Interactive Crank Handle
    this.drawCrank(ctx, crankCx, crankCy, crankR);

    // 9. Exit Chute & Rolling Capsule Animation
    this.drawExitChute(ctx, chuteCx, chuteCy, globeR);

    // 10. Floating 4-Point Anime Sparkles
    this.drawSparkles(ctx);

    ctx.restore();
  }

  drawMachineBase(ctx, { cx, globeCy, globeR, chuteCy }) {
    const topY = globeCy + globeR * 0.84;
    const bottomY = chuteCy + globeR * 0.42;
    const topHalfW = globeR * 0.76;
    const botHalfW = globeR * 0.92;

    ctx.save();
    const baseGrad = ctx.createLinearGradient(cx - botHalfW, topY, cx + botHalfW, bottomY);
    baseGrad.addColorStop(0, '#FF9EC4');
    baseGrad.addColorStop(0.5, '#FF7EB0');
    baseGrad.addColorStop(1, '#F2669B');

    ctx.beginPath();
    ctx.moveTo(cx - topHalfW, topY);
    ctx.lineTo(cx + topHalfW, topY);
    ctx.quadraticCurveTo(cx + botHalfW * 1.03, (topY + bottomY) * 0.5, cx + botHalfW, bottomY - 18);
    ctx.quadraticCurveTo(cx + botHalfW, bottomY, cx + botHalfW - 20, bottomY);
    ctx.lineTo(cx - botHalfW + 20, bottomY);
    ctx.quadraticCurveTo(cx - botHalfW, bottomY, cx - botHalfW, bottomY - 18);
    ctx.quadraticCurveTo(cx - botHalfW * 1.03, (topY + bottomY) * 0.5, cx - topHalfW, topY);
    ctx.closePath();

    ctx.fillStyle = baseGrad;
    ctx.fill();

    // Cute cream vertical party stripes clipped inside base
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 246, 250, 0.24)';
    for (let offset = -3; offset <= 3; offset += 2) {
      ctx.fillRect(cx + offset * (globeR * 0.22) - 10, topY, 20, bottomY - topY);
    }
    // Side gloss highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.beginPath();
    ctx.ellipse(cx - botHalfW * 0.68, (topY + bottomY) * 0.52, 12, (bottomY - topY) * 0.36, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = 4;
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();

    // Cute little feet at bottom corners
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + dir * (botHalfW * 0.72), bottomY + 3, 20, 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#FFE394';
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = LINE_COLOR;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCollar(ctx, cx, collarY, globeR) {
    const w = globeR * 1.64;
    const h = 22;
    ctx.save();
    ctx.beginPath();
    drawRoundedRect(ctx, cx - w / 2, collarY - h / 2, w, h, 11);
    ctx.fillStyle = '#FFF3C4';
    ctx.fill();
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();

    // Cute decorative polka studs on collar
    const dotColors = ['#FF8FB8', '#75C4FF', '#6EE5BD', '#C296FF', '#FF8FB8'];
    for (let i = 0; i < 5; i++) {
      const dx = cx + (i - 2) * (w * 0.18);
      ctx.beginPath();
      ctx.arc(dx, collarY, 4, 0, Math.PI * 2);
      ctx.fillStyle = dotColors[i];
      ctx.fill();
    }
    ctx.restore();
  }

  drawTopLid(ctx, cx, globeCy, globeR) {
    ctx.save();
    const lidBaseY = globeCy - globeR * 0.88;
    const lidW = globeR * 1.15;

    // Tilt open slightly when capsules pour in
    ctx.translate(cx - lidW * 0.45, lidBaseY);
    ctx.rotate(-this.lidOpenAmount * 0.42);
    ctx.translate(-(cx - lidW * 0.45), -lidBaseY);

    // Lid dome cap
    ctx.beginPath();
    ctx.ellipse(cx, lidBaseY, lidW * 0.52, globeR * 0.19, 0, Math.PI, 0, false);
    ctx.quadraticCurveTo(cx + lidW * 0.56, lidBaseY + 10, cx + lidW * 0.48, lidBaseY + 12);
    ctx.lineTo(cx - lidW * 0.48, lidBaseY + 12);
    ctx.quadraticCurveTo(cx - lidW * 0.56, lidBaseY + 10, cx - lidW * 0.52, lidBaseY);
    ctx.closePath();

    const capGrad = ctx.createLinearGradient(cx, lidBaseY - globeR * 0.22, cx, lidBaseY + 12);
    capGrad.addColorStop(0, '#FFB5D2');
    capGrad.addColorStop(1, '#FF7EB0');
    ctx.fillStyle = capGrad;
    ctx.fill();
    ctx.lineWidth = 3.8;
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();

    // Cute Pastel Yellow Star Knob on top
    this.drawStar(ctx, cx, lidBaseY - globeR * 0.22, 5, 14, 7, '#FFE066');
    ctx.restore();
  }

  drawGlassReflections(ctx, cx, globeCy, globeR) {
    ctx.save();
    // Big soft curved reflection arc on upper-left
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.lineWidth = globeR * 0.085;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, globeCy, globeR * 0.84, Math.PI * 1.12, Math.PI * 1.42);
    ctx.stroke();

    // Small dot reflection
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.beginPath();
    ctx.ellipse(
      cx - globeR * 0.32,
      globeCy - globeR * 0.76,
      globeR * 0.055,
      globeR * 0.035,
      -0.4,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Subtle lower-right rim light
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = globeR * 0.04;
    ctx.beginPath();
    ctx.arc(cx, globeCy, globeR * 0.88, Math.PI * 0.14, Math.PI * 0.34);
    ctx.stroke();
    ctx.restore();
  }

  drawCapsuleBall(ctx, x, y, r, angle, theme) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Bottom creamy translucent shell
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI);
    ctx.closePath();
    ctx.fillStyle = theme.bottom;
    ctx.fill();

    // Tiny folded gift slip peeking inside bottom half
    ctx.fillStyle = theme.topLight;
    ctx.fillRect(-r * 0.38, r * 0.18, r * 0.76, r * 0.36);

    // Top pastel colored shell
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = theme.top;
    ctx.fill();

    // Center seam belt
    ctx.fillStyle = theme.rim;
    ctx.fillRect(-r, -r * 0.11, r * 2, r * 0.22);

    // Specular shine dot on top half
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.34, -r * 0.42, r * 0.24, r * 0.13, -0.45, 0, Math.PI * 2);
    ctx.fill();

    // Crisp cel-outline
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.8, r * 0.13);
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();

    ctx.restore();
  }

  drawCrank(ctx, cx, cy, r) {
    ctx.save();
    const scale = this.hoveredInteractive && this.canInteract ? 1.07 : 1;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // Outer glow pulse when ready to spin
    if (this.canInteract && !this.crankAnim.active) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.005);
      ctx.beginPath();
      ctx.arc(0, 0, r + 6 + pulse * 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 240, 150, ${0.28 + pulse * 0.25})`;
      ctx.fill();
    }

    // Cream dial plate
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFDF5';
    ctx.fill();
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();

    // Inner pastel ring
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.76, 0, Math.PI * 2);
    ctx.fillStyle = '#FFE394';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();

    // Rotating handle bar
    ctx.rotate(this.crankAnim.angle);
    ctx.beginPath();
    drawRoundedRect(ctx, -r * 0.86, -r * 0.24, r * 1.72, r * 0.48, r * 0.24);
    ctx.fillStyle = '#FFF7FA';
    ctx.fill();
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();

    // Center pink heart/circle cap
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = '#FF8FB8';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();

    ctx.restore();
  }

  drawExitChute(ctx, cx, cy, globeR) {
    const chuteW = globeR * 0.62;
    const chuteH = globeR * 0.52;

    ctx.save();
    // Outer frame
    ctx.beginPath();
    drawRoundedRect(ctx, cx - chuteW / 2 - 6, cy - chuteH / 2 - 6, chuteW + 12, chuteH + 12, 16);
    ctx.fillStyle = '#FFF3C4';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();

    // Dark recessed pocket
    ctx.beginPath();
    drawRoundedRect(ctx, cx - chuteW / 2, cy - chuteH / 2, chuteW, chuteH, 12);
    ctx.fillStyle = '#6E465B';
    ctx.fill();
    ctx.clip();

    // During final 1-second tail after speech, show capsule dropping into chute!
    if (this.crankAnim.active && this.crankAnim.mode === 'tail') {
      const progress = this.crankAnim.tailElapsed / this.crankAnim.tailDuration;
      if (progress > 0.42) {
        const dropT = Math.min(1, (progress - 0.42) / 0.5);
        const bounceY = cy - chuteH * 0.65 + dropT * (chuteH * 0.72);
        this.drawCapsuleBall(
          ctx,
          cx,
          bounceY,
          chuteW * 0.3,
          dropT * 2.4,
          this.crankAnim.ejectTheme
        );
      }
    }

    // Translucent swinging chute flap
    ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
    ctx.fillRect(cx - chuteW / 2, cy - chuteH / 2, chuteW, chuteH * 0.52);
    ctx.restore();
  }

  drawStar(ctx, cx, cy, spikes, outerR, innerR, fillStyle) {
    ctx.save();
    ctx.beginPath();
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
      rot += step;
    }
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = LINE_COLOR;
    ctx.stroke();
    ctx.restore();
  }

  drawSparkles(ctx) {
    for (const sp of this.sparkles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, sp.life);
      ctx.translate(sp.x, sp.y);
      ctx.fillStyle = sp.color;
      const r = sp.size;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.2, -r * 0.2, r, 0);
      ctx.quadraticCurveTo(r * 0.2, r * 0.2, 0, r);
      ctx.quadraticCurveTo(-r * 0.2, r * 0.2, -r, 0);
      ctx.quadraticCurveTo(-r * 0.2, -r * 0.2, 0, -r);
      ctx.fill();
      ctx.restore();
    }
  }
}
