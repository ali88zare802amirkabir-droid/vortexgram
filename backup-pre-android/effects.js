/* VORTEXGRAM Profile Effects Engine v1.0 — Canvas-based Discord-style effects */
(function () {
  'use strict';

  /* ─── Particle base ─── */
  class Particle {
    constructor(x, y, opts = {}) {
      this.x = x; this.y = y;
      this.vx = opts.vx || 0; this.vy = opts.vy || 0;
      this.life = opts.life || 1; this.maxLife = this.life;
      this.size = opts.size || 3;
      this.color = opts.color || '#ff6600';
      this.alpha = opts.alpha != null ? opts.alpha : 1;
      this.gravity = opts.gravity || 0;
      this.friction = opts.friction || 1;
      this.shrink = opts.shrink != null ? opts.shrink : true;
      this.glow = opts.glow || false;
      this.shape = opts.shape || 'circle'; // circle, square, diamond, star
    }
    update(dt) {
      this.vy += this.gravity * dt;
      this.vx *= this.friction; this.vy *= this.friction;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.life -= dt;
      const pct = Math.max(0, this.life / this.maxLife);
      this.alpha = pct;
      if (this.shrink) this.size *= (0.98 + 0.02 * pct);
    }
    draw(ctx) {
      if (this.alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      if (this.glow) { ctx.shadowBlur = this.size * 3; ctx.shadowColor = this.color; }
      ctx.fillStyle = this.color;
      ctx.beginPath();
      if (this.shape === 'circle') {
        ctx.arc(this.x, this.y, Math.max(0.5, this.size), 0, Math.PI * 2);
      } else if (this.shape === 'diamond') {
        const s = this.size;
        ctx.moveTo(this.x, this.y - s); ctx.lineTo(this.x + s, this.y);
        ctx.lineTo(this.x, this.y + s); ctx.lineTo(this.x - s, this.y);
      } else if (this.shape === 'star') {
        drawStar(ctx, this.x, this.y, 5, this.size, this.size * 0.4);
      } else {
        ctx.rect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
      }
      ctx.fill();
      ctx.restore();
    }
    get dead() { return this.life <= 0; }
  }

  function drawStar(ctx, cx, cy, spikes, outerR, innerR) {
    let rot = Math.PI / 2 * 3, step = Math.PI / spikes;
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerR);
  }

  /* ─── Utility ─── */
  function rand(a, b) { return a + Math.random() * (b - a); }
  function lerpColor(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
    const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
    const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  }

  /* ═══════════════════════════════════════════
     INFERNO — Fire + Embers + Smoke + Glow
     ═══════════════════════════════════════════ */
  class InfernoEffect {
    constructor() { this.particles = []; this.time = 0; this.flashAlpha = 0; }
    update(dt, w, h, color) {
      this.time += dt;
      this.flashAlpha *= 0.92;
      // Fire core — bottom center
      const cx = w / 2, baseY = h * 0.85;
      for (let i = 0; i < 6; i++) {
        const spread = rand(-w * 0.25, w * 0.25);
        const speed = rand(80, 180);
        const life = rand(0.6, 1.4);
        const sz = rand(4, 12);
        const hue = rand(-20, 20);
        this.particles.push(new Particle(cx + spread, baseY + rand(-10, 10), {
          vx: rand(-15, 15), vy: -speed, life, size: sz,
          color: lerpColor(color, '#ff4400', Math.random()),
          gravity: -40, friction: 0.99, glow: true, shape: 'circle'
        }));
      }
      // Embers — fly up fast, small
      if (Math.random() < 0.4) {
        this.particles.push(new Particle(cx + rand(-w * 0.2, w * 0.2), baseY, {
          vx: rand(-30, 30), vy: rand(-200, -100), life: rand(1, 2.5),
          size: rand(1.5, 3.5), color: lerpColor('#ffcc00', color, Math.random()),
          gravity: -20, friction: 0.995, glow: true, shape: 'circle'
        }));
      }
      // Smoke — slow, dark, drifts up
      if (Math.random() < 0.15) {
        this.particles.push(new Particle(cx + rand(-w * 0.15, w * 0.15), baseY - 20, {
          vx: rand(-8, 8), vy: rand(-40, -15), life: rand(2, 4),
          size: rand(8, 20), color: '#1a1a1a', alpha: 0.25,
          gravity: -5, friction: 0.98, glow: false, shrink: false, shape: 'circle'
        }));
      }
      // Occasional flash
      if (Math.random() < 0.008) this.flashAlpha = rand(0.05, 0.15);
      // Update
      this.particles.forEach(p => p.update(dt));
      this.particles = this.particles.filter(p => !p.dead && p.y > -50 && p.y < h + 50);
    }
    draw(ctx, w, h, color) {
      // Background glow — localized at fire source
      const grad = ctx.createRadialGradient(w / 2, h * 0.85, 10, w / 2, h * 0.85, w * 0.4);
      grad.addColorStop(0, color + '30');
      grad.addColorStop(0.5, color + '10');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // Particles
      this.particles.forEach(p => p.draw(ctx));
      // Flash — localized radial gradient
      if (this.flashAlpha > 0.01) {
        const grad2 = ctx.createRadialGradient(w / 2, h * 0.85, 5, w / 2, h * 0.85, w * 0.35);
        grad2.addColorStop(0, `rgba(255,200,100,${this.flashAlpha})`);
        grad2.addColorStop(0.5, `rgba(255,150,50,${this.flashAlpha * 0.3})`);
        grad2.addColorStop(1, 'transparent');
        ctx.fillStyle = grad2;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  /* ═══════════════════════════════════════════
     LIGHTNING — Electric arcs + flash
     ═══════════════════════════════════════════ */
  class LightningEffect {
    constructor() { this.arcs = []; this.flashAlpha = 0; this.flashX = 0; this.flashY = 0; this.time = 0; this.nextStrike = rand(0.5, 2); }
    update(dt, w, h, color) {
      this.time += dt;
      this.flashAlpha *= 0.7; // Faster decay
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.nextStrike = rand(1.5, 5);
        const arc = this.generateArc(w, h, color);
        this.arcs.push(arc);
        // Flash at the arc's center
        const mid = arc.points[Math.floor(arc.points.length / 2)];
        this.flashX = mid.x;
        this.flashY = mid.y;
        this.flashAlpha = rand(0.3, 0.6);
      }
      this.arcs.forEach(a => { a.life -= dt; });
      this.arcs = this.arcs.filter(a => a.life > 0);
    }
    generateArc(w, h, color) {
      const points = [];
      const startX = rand(w * 0.15, w * 0.85);
      const startY = 0;
      let x = startX, y = startY;
      const segments = Math.floor(rand(5, 10));
      const targetY = h * 0.7;
      for (let i = 0; i < segments; i++) {
        x += rand(-w * 0.12, w * 0.12);
        y += (targetY - startY) / segments + rand(-8, 8);
        points.push({ x, y });
      }
      return { points, life: rand(0.08, 0.2), color, width: rand(1.5, 3.5), branches: Math.random() < 0.35 ? this.generateBranches(points, w) : [] };
    }
    generateBranches(mainPoints, w) {
      const branches = [];
      const count = Math.floor(rand(1, 2));
      for (let b = 0; b < count; b++) {
        const idx = Math.floor(rand(1, mainPoints.length - 1));
        const start = mainPoints[idx];
        const pts = [{ x: start.x, y: start.y }];
        let x = start.x, y = start.y;
        const len = Math.floor(rand(2, 4));
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (let i = 0; i < len; i++) {
          x += dir * rand(5, 20);
          y += rand(5, 15);
          pts.push({ x, y });
        }
        branches.push({ points: pts, life: rand(0.05, 0.15), color: '#ffffff', width: rand(0.8, 1.2) });
      }
      return branches;
    }
    draw(ctx, w, h, color) {
      // Localized flash — radial gradient at flash point
      if (this.flashAlpha > 0.01) {
        const grad = ctx.createRadialGradient(this.flashX, this.flashY, 0, this.flashX, this.flashY, w * 0.4);
        grad.addColorStop(0, `rgba(255,255,255,${this.flashAlpha})`);
        grad.addColorStop(0.3, `rgba(255,255,255,${this.flashAlpha * 0.4})`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }
      // Arcs
      this.arcs.forEach(a => {
        const alpha = Math.min(1, a.life * 8); // Faster fade
        // Glow
        ctx.save();
        ctx.globalAlpha = alpha * 0.35;
        ctx.strokeStyle = color;
        ctx.lineWidth = a.width * 5;
        ctx.shadowBlur = 20;
        ctx.shadowColor = color;
        ctx.beginPath();
        a.points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.restore();
        // Core — bright white
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = a.width;
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#ffffff';
        ctx.beginPath();
        a.points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
        ctx.stroke();
        ctx.restore();
        // Branches
        a.branches.forEach(br => {
          const ba = Math.min(1, br.life * 10);
          ctx.save();
          ctx.globalAlpha = ba * 0.5;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = br.width;
          ctx.shadowBlur = 6;
          ctx.shadowColor = color;
          ctx.beginPath();
          br.points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
          ctx.stroke();
          ctx.restore();
        });
      });
    }
  }

  /* ═══════════════════════════════════════════
     FROST — Ice crystals + cold mist
     ═══════════════════════════════════════════ */
  class FrostEffect {
    constructor() { this.crystals = []; this.mist = []; this.time = 0; }
    update(dt, w, h, color) {
      this.time += dt;
      // Spawn crystals at edges
      if (Math.random() < 0.12 && this.crystals.length < 40) {
        const side = Math.floor(Math.random() * 4);
        let x, y;
        if (side === 0) { x = rand(0, w); y = 0; }
        else if (side === 1) { x = w; y = rand(0, h); }
        else if (side === 2) { x = rand(0, w); y = h; }
        else { x = 0; y = rand(0, h); }
        this.crystals.push({
          x, y, size: rand(2, 6), rotation: rand(0, Math.PI * 2),
          rotSpeed: rand(-1, 1), life: rand(3, 8), maxLife: 8,
          alpha: 0, fadeIn: true
        });
      }
      // Mist
      if (Math.random() < 0.08 && this.mist.length < 15) {
        this.mist.push(new Particle(rand(0, w), h + 10, {
          vx: rand(-10, 10), vy: rand(-25, -8), life: rand(3, 6),
          size: rand(20, 50), color: '#c8e6ff', alpha: 0.12,
          gravity: -2, friction: 0.99, glow: false, shrink: false, shape: 'circle'
        }));
      }
      // Update crystals
      this.crystals.forEach(c => {
        c.rotation += c.rotSpeed * dt;
        c.life -= dt;
        if (c.fadeIn && c.alpha < 0.7) c.alpha += dt * 0.5;
        if (c.life < 1) c.alpha = c.life;
      });
      this.crystals = this.crystals.filter(c => c.life > 0);
      this.mist.forEach(p => p.update(dt));
      this.mist = this.mist.filter(p => !p.dead);
    }
    draw(ctx, w, h, color) {
      // Mist
      this.mist.forEach(p => p.draw(ctx));
      // Crystals — snowflake-like hexagons
      this.crystals.forEach(c => {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rotation);
        ctx.globalAlpha = Math.max(0, c.alpha);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 8;
        ctx.shadowColor = color;
        // 6 branches
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          const ex = Math.cos(angle) * c.size;
          const ey = Math.sin(angle) * c.size;
          ctx.lineTo(ex, ey);
          ctx.stroke();
          // Small side branches
          if (c.size > 3) {
            const mx = ex * 0.6, my = ey * 0.6;
            const perp = angle + Math.PI / 2;
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.lineTo(mx + Math.cos(perp) * c.size * 0.3, my + Math.sin(perp) * c.size * 0.3);
            ctx.stroke();
          }
        }
        ctx.restore();
      });
    }
  }

  /* ═══════════════════════════════════════════
     GHOST — Translucent figure passing through
     ═══════════════════════════════════════════ */
  class GhostEffect {
    constructor() { this.time = 0; this.phase = 'idle'; this.x = 0; this.y = 0; this.alpha = 0; }
    update(dt, w, h, color) {
      this.time += dt;
      const cycle = this.time % 10;
      if (cycle < 3) {
        // Rise from bottom
        this.phase = 'rise';
        this.x = w / 2 + Math.sin(this.time * 1.5) * 20;
        this.y = h - (cycle / 3) * h * 0.7;
        this.alpha = Math.min(0.4, cycle / 3 * 0.4);
      } else if (cycle < 6) {
        // Float across
        this.phase = 'float';
        this.x = w / 2 + Math.sin(this.time * 0.8) * w * 0.3;
        this.y = h * 0.3 + Math.sin(this.time * 2) * 15;
        this.alpha = 0.3 + Math.sin(this.time * 3) * 0.1;
      } else {
        // Fade out
        this.phase = 'fade';
        this.alpha *= 0.95;
      }
    }
    draw(ctx, w, h, color) {
      if (this.alpha < 0.01) return;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.globalCompositeOperation = 'screen';
      // Ghost body — flowing shape
      const cx = this.x, cy = this.y;
      const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 60);
      grad.addColorStop(0, color);
      grad.addColorStop(0.4, color + '60');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      // Wavy bottom edge
      for (let i = 0; i <= 20; i++) {
        const angle = (i / 20) * Math.PI;
        const r = 35 + Math.sin(this.time * 4 + i * 0.8) * 8;
        const px = cx + Math.cos(angle) * r;
        const py = cy - 25 + Math.sin(angle) * r * 0.5;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      // Bottom wavy tail
      for (let i = 20; i >= 0; i--) {
        const angle = (i / 20) * Math.PI;
        const wave = Math.sin(this.time * 5 + i * 1.2) * 12;
        const r = 35;
        const px = cx + Math.cos(angle) * r;
        const py = cy + 35 + wave + (i % 2 === 0 ? 10 : 0);
        ctx.lineTo(px, py);
      }
      ctx.fill();
      // Eyes
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = this.alpha * 1.5;
      ctx.beginPath();
      ctx.ellipse(cx - 10, cy - 5, 4, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 10, cy - 5, 4, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════
     BUTTERFLY — Flying butterflies
     ═══════════════════════════════════════════ */
  class ButterflyEffect {
    constructor() { this.butterflies = []; this.time = 0; }
    update(dt, w, h, color) {
      this.time += dt;
      // Spawn
      if (Math.random() < 0.02 && this.butterflies.length < 8) {
        this.butterflies.push({
          x: rand(0, w), y: rand(h * 0.2, h * 0.8),
          vx: rand(-20, 20), vy: rand(-15, 15),
          wingPhase: rand(0, Math.PI * 2), wingSpeed: rand(8, 14),
          size: rand(6, 12), life: rand(6, 12), maxLife: 12,
          hue: rand(0, 360), wobble: rand(0, 3), angle: rand(0, Math.PI * 2)
        });
      }
      this.butterflies.forEach(b => {
        b.life -= dt;
        b.wingPhase += b.wingSpeed * dt;
        // Wander
        b.angle += (Math.random() - 0.5) * dt * 2;
        b.vx += Math.cos(b.angle) * 15 * dt;
        b.vy += Math.sin(b.angle) * 15 * dt;
        b.vx *= 0.98; b.vy *= 0.98;
        b.x += b.vx * dt; b.y += b.vy * dt;
        // Bounds
        if (b.x < -20) b.x = w + 20;
        if (b.x > w + 20) b.x = -20;
        if (b.y < -20) b.y = h + 20;
        if (b.y > h + 20) b.y = -20;
      });
      this.butterflies = this.butterflies.filter(b => b.life > 0);
    }
    draw(ctx, w, h, color) {
      this.butterflies.forEach(b => {
        const alpha = b.life < 2 ? b.life / 2 : (b.maxLife - b.life < 1 ? b.maxLife - b.life : 1);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx) * 0.3);
        ctx.globalAlpha = alpha * 0.8;
        // Wings
        const wingAngle = Math.sin(b.wingPhase) * 0.7;
        const s = b.size;
        // Left wing
        ctx.save();
        ctx.scale(Math.cos(wingAngle), 1);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(-s * 0.6, 0, s, s * 0.6, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Right wing
        ctx.save();
        ctx.scale(Math.cos(wingAngle + Math.PI), 1);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(s * 0.6, 0, s, s * 0.6, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Body
        ctx.fillStyle = '#000000';
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.ellipse(0, 0, 1.5, s * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }
  }

  /* ═══════════════════════════════════════════
     PETALS — Flower petals in wind
     ═══════════════════════════════════════════ */
  class PetalsEffect {
    constructor() { this.petals = []; this.time = 0; }
    update(dt, w, h, color) {
      this.time += dt;
      if (Math.random() < 0.15 && this.petals.length < 25) {
        this.petals.push(new Particle(rand(0, w), rand(-20, -5), {
          vx: rand(15, 40), vy: rand(10, 35), life: rand(4, 8),
          size: rand(4, 8), color: lerpColor(color, '#ffb6c1', Math.random()),
          gravity: 5, friction: 0.998, glow: false, shape: 'circle'
        }));
      }
      this.petals.forEach(p => {
        p.update(dt);
        // Wobble
        p.x += Math.sin(this.time * 3 + p.maxLife * 10) * 0.5;
        p.rotation = this.time * 2 + p.maxLife * 5;
      });
      this.petals = this.petals.filter(p => !p.dead && p.y < h + 20);
    }
    draw(ctx, w, h, color) {
      this.petals.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation || 0);
        ctx.globalAlpha = p.alpha * 0.7;
        ctx.fillStyle = p.color;
        // Petal shape — 2 ellipses
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.4, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }
  }

  /* ═══════════════════════════════════════════
     SPIDER — SVG-like creature walking on frame
     ═══════════════════════════════════════════ */
  class SpiderEffect {
    constructor() {
      this.time = 0;
      this.spider = { x: 0, y: 0, angle: 0, targetAngle: 0, speed: 0, paused: false, pauseTimer: 0, side: 0 };
      this.init = false;
    }
    update(dt, w, h, color) {
      this.time += dt;
      const s = this.spider;
      if (!this.init) {
        s.x = w; s.y = h * 0.3; s.side = 1; this.init = true;
      }
      s.pauseTimer -= dt;
      if (s.pauseTimer <= 0) {
        s.paused = !s.paused;
        s.pauseTimer = s.paused ? rand(0.5, 2) : rand(2, 5);
        if (!s.paused) {
          // Change direction along frame edge
          s.side = (s.side + 1) % 4;
        }
      }
      if (!s.paused) {
        s.speed = 35;
        // Move along frame perimeter
        if (s.side === 0) { s.y -= s.speed * dt; s.angle = -Math.PI / 2; } // top
        else if (s.side === 1) { s.x -= s.speed * dt; s.angle = Math.PI; } // right
        else if (s.side === 2) { s.y += s.speed * dt; s.angle = Math.PI / 2; } // bottom
        else { s.x += s.speed * dt; s.angle = 0; } // left
        // Bounds
        s.x = Math.max(5, Math.min(w - 5, s.x));
        s.y = Math.max(5, Math.min(h - 5, s.y));
      }
    }
    draw(ctx, w, h, color) {
      const s = this.spider;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      const legPhase = s.paused ? 0 : this.time * 8;
      // Shadow
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(2, 2, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = color;
      ctx.shadowBlur = 6;
      ctx.shadowColor = color;
      // Abdomen
      ctx.beginPath();
      ctx.ellipse(-6, 0, 7, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Cephalothorax
      ctx.beginPath();
      ctx.ellipse(4, 0, 5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Legs (4 pairs)
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = color;
      for (let i = 0; i < 4; i++) {
        const baseX = -2 + i * 3;
        const legAngle = Math.sin(legPhase + i * 0.8) * (s.paused ? 0.1 : 0.4);
        // Upper
        ctx.beginPath();
        ctx.moveTo(baseX, -3);
        ctx.lineTo(baseX - 8, -10 + Math.sin(legAngle) * 3);
        ctx.stroke();
        // Lower
        ctx.beginPath();
        ctx.moveTo(baseX - 8, -10 + Math.sin(legAngle) * 3);
        ctx.lineTo(baseX - 14, -6 + Math.sin(legAngle + 1) * 4);
        ctx.stroke();
        // Mirror
        ctx.beginPath();
        ctx.moveTo(baseX, 3);
        ctx.lineTo(baseX - 8, 10 - Math.sin(legAngle) * 3);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(baseX - 8, 10 - Math.sin(legAngle) * 3);
        ctx.lineTo(baseX - 14, 6 - Math.sin(legAngle + 1) * 4);
        ctx.stroke();
      }
      // Eyes
      ctx.fillStyle = '#ff0000';
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(7, -2, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(7, 2, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════
     VOID — Space particles + energy vortex
     ═══════════════════════════════════════════ */
  class VoidEffect {
    constructor() { this.particles = []; this.time = 0; }
    update(dt, w, h, color) {
      this.time += dt;
      // Spawn stars
      if (Math.random() < 0.3 && this.particles.length < 60) {
        const angle = rand(0, Math.PI * 2);
        const dist = rand(20, Math.max(w, h) * 0.6);
        this.particles.push({
          x: w / 2 + Math.cos(angle) * dist,
          y: h / 2 + Math.sin(angle) * dist,
          size: rand(1, 3), life: rand(3, 8), maxLife: 8,
          color: Math.random() < 0.5 ? color : '#ffffff',
          orbitAngle: angle, orbitSpeed: rand(0.3, 1.5), orbitDist: dist
        });
      }
      this.particles.forEach(p => {
        p.life -= dt;
        p.orbitAngle += p.orbitSpeed * dt;
        const spiral = p.orbitDist * (1 - (1 - p.life / p.maxLife) * 0.3);
        p.x = w / 2 + Math.cos(p.orbitAngle) * spiral;
        p.y = h / 2 + Math.sin(p.orbitAngle) * spiral;
      });
      this.particles = this.particles.filter(p => p.life > 0);
    }
    draw(ctx, w, h, color) {
      // Central vortex glow
      const grad = ctx.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, w * 0.4);
      grad.addColorStop(0, color + '25');
      grad.addColorStop(0.5, color + '08');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // Particles
      this.particles.forEach(p => {
        const alpha = Math.min(1, p.life / p.maxLife * 2);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = p.size * 4;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }
  }

  /* ═══════════════════════════════════════════
     SMOKE — Heavy smoke rising
     ═══════════════════════════════════════════ */
  class SmokeEffect {
    constructor() { this.particles = []; }
    update(dt, w, h, color) {
      if (Math.random() < 0.2 && this.particles.length < 30) {
        this.particles.push(new Particle(w / 2 + rand(-w * 0.3, w * 0.3), h + 5, {
          vx: rand(-12, 12), vy: rand(-50, -20), life: rand(4, 8),
          size: rand(15, 40), color: '#222222', alpha: 0.3,
          gravity: -3, friction: 0.995, glow: false, shrink: false, shape: 'circle'
        }));
      }
      this.particles.forEach(p => {
        p.update(dt);
        p.x += Math.sin(this.time || 0 + p.maxLife * 5) * 0.3;
      });
      this.time = (this.time || 0) + dt;
      this.particles = this.particles.filter(p => !p.dead && p.y > -60);
    }
    draw(ctx, w, h, color) {
      this.particles.forEach(p => {
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, `rgba(30,30,30,${p.alpha * p.alpha})`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      });
    }
  }

  /* ═══════════════════════════════════════════
     HELLSTORM — Fire + Lightning + Smoke
     ═══════════════════════════════════════════ */
  class HellstormEffect {
    constructor() {
      this.inferno = new InfernoEffect();
      this.lightning = new LightningEffect();
      this.smoke = new SmokeEffect();
    }
    update(dt, w, h, color) {
      this.inferno.update(dt, w, h, color);
      this.lightning.update(dt, w, h, '#ff4400');
      this.smoke.update(dt, w, h, color);
    }
    draw(ctx, w, h, color) {
      this.smoke.draw(ctx, w, h, color);
      this.inferno.draw(ctx, w, h, color);
      this.lightning.draw(ctx, w, h, '#ffaa00');
    }
  }

  /* ═══════════════════════════════════════════
     SHADOW BEAST — Emerging shadow creature
     ═══════════════════════════════════════════ */
  class ShadowBeastEffect {
    constructor() { this.time = 0; }
    update(dt) { this.time += dt; }
    draw(ctx, w, h, color) {
      const phase = (this.time * 0.3) % (Math.PI * 2);
      const emerge = Math.max(0, Math.sin(phase)) * 0.7;
      if (emerge < 0.05) return;
      ctx.save();
      ctx.globalAlpha = emerge * 0.6;
      ctx.globalCompositeOperation = 'screen';
      // Shadow body rising from bottom
      const cx = w / 2, baseY = h;
      const bodyH = emerge * h * 0.6;
      const grad = ctx.createLinearGradient(cx, baseY, cx, baseY - bodyH);
      grad.addColorStop(0, '#000000');
      grad.addColorStop(0.5, color + '40');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx - 30, baseY);
      ctx.quadraticCurveTo(cx - 40, baseY - bodyH * 0.5, cx - 15 + Math.sin(this.time * 2) * 5, baseY - bodyH);
      ctx.quadraticCurveTo(cx, baseY - bodyH - 15, cx + 15 + Math.sin(this.time * 2.5) * 5, baseY - bodyH);
      ctx.quadraticCurveTo(cx + 40, baseY - bodyH * 0.5, cx + 30, baseY);
      ctx.fill();
      // Eyes
      if (emerge > 0.3) {
        ctx.fillStyle = color;
        ctx.globalAlpha = emerge;
        const eyeY = baseY - bodyH * 0.65;
        ctx.beginPath();
        ctx.ellipse(cx - 12 + Math.sin(this.time) * 2, eyeY, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + 12 + Math.sin(this.time + 1) * 2, eyeY, 4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /* ═══════════════════════════════════════════
     MAIN ENGINE
     ═══════════════════════════════════════════ */
  const EFFECT_MAP = {
    inferno: InfernoEffect, lightning: LightningEffect, frost: FrostEffect,
    ghost: GhostEffect, butterfly: ButterflyEffect, petals: PetalsEffect,
    spider: SpiderEffect, void: VoidEffect, smoke: SmokeEffect,
    hellstorm: HellstormEffect, 'shadow-beast': ShadowBeastEffect,
  };

  class ProfileEffectEngine {
    constructor(container, effectType, color) {
      this.canvas = document.createElement('canvas');
      // Extend 100px beyond container on all sides
      this.canvas.style.cssText = 'position:absolute;top:-100px;left:-100px;width:calc(100% + 200px);height:calc(100% + 200px);pointer-events:none;z-index:2;border-radius:inherit;overflow:visible;';
      this.ctx = this.canvas.getContext('2d');
      this.container = container;
      this.color = color || '#3b82f6';
      this.effectType = effectType;
      this.effect = null;
      this.running = false;
      this.lastTime = 0;
      this.init();
    }
    init() {
      const Ctor = EFFECT_MAP[this.effectType];
      if (!Ctor) return;
      this.effect = new Ctor();
      this.container.style.position = 'relative';
      this.container.style.overflow = 'visible';
      this.container.appendChild(this.canvas);
      this.resize();
      this.running = true;
      this.lastTime = performance.now();
      this.loop();
      this._resizeHandler = () => this.resize();
      window.addEventListener('resize', this._resizeHandler);
    }
    resize() {
      const rect = this.container.getBoundingClientRect();
      // Add 200px padding (100px each side)
      const w = rect.width + 200;
      const h = rect.height + 200;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = w;
      this.h = h;
      this.offsetX = 100;
      this.offsetY = 100;
    }
    loop() {
      if (!this.running) return;
      const now = performance.now();
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.effect) {
        this.effect.update(dt, this.w, this.h, this.color);
        this.effect.draw(this.ctx, this.w, this.h, this.color);
      }
      requestAnimationFrame(() => this.loop());
    }
    setColor(c) { this.color = c; }
    destroy() {
      this.running = false;
      window.removeEventListener('resize', this._resizeHandler);
      if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
  }

  /* Expose */
  window.ProfileEffectEngine = ProfileEffectEngine;
  window.ProfileEffectTypes = Object.keys(EFFECT_MAP);
})();
