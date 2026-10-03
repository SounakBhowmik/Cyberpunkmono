// The neon ICE monsters: each a small animated vector creature centred on (0, 0).

export type GlowFn = (color: string, blur: number) => void;


/** Each ICE monster is a little animated vector creature centred on (0, 0). */
export function drawMonster(ctx: CanvasRenderingContext2D, id: string, s: number, t: number, color: string, glow: GlowFn, noGlow: () => void) {
  glow(color, 18);
  ctx.strokeStyle = color;
  ctx.fillStyle = '#0c0a18';
  ctx.lineWidth = 2.5;
  const eyes = (pts: [number, number][], r: number) => {
    ctx.fillStyle = color;
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0c0a18';
  };

  switch (id) {
    case 'hound': {
      const step = Math.sin(t * 8);
      ctx.beginPath();
      // spiky back
      ctx.moveTo(-s * 0.9, -s * 0.1);
      for (let i = 0; i <= 8; i++) {
        const x = -s * 0.7 + i * s * 0.18;
        ctx.lineTo(x, -s * (i % 2 ? 0.55 : 0.35) + Math.sin(t * 6 + i) * 3);
      }
      ctx.lineTo(s * 0.8, s * 0.05);
      ctx.lineTo(s * 0.7, s * 0.3);
      ctx.lineTo(-s * 0.6, s * 0.3);
      ctx.lineTo(-s * 1.0, s * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // legs
      ctx.beginPath();
      for (const [x, ph] of [[-s * 0.45, 0], [-s * 0.15, 1], [s * 0.25, 0], [s * 0.55, 1]] as const) {
        const sw = (ph ? step : -step) * s * 0.1;
        ctx.moveTo(x, s * 0.3);
        ctx.lineTo(x + sw, s * 0.65);
      }
      ctx.stroke();
      // jaws
      const open = 0.1 + 0.08 * Math.abs(Math.sin(t * 5));
      ctx.beginPath();
      ctx.moveTo(-s * 1.0, s * 0.1);
      ctx.lineTo(-s * 1.35, s * (0.1 + open));
      ctx.lineTo(-s * 0.85, s * 0.22);
      ctx.stroke();
      eyes([[-s * 0.78, -s * 0.05], [-s * 0.62, -s * 0.07]], s * 0.05);
      break;
    }
    case 'ooze': {
      ctx.beginPath();
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const a = Math.PI + (i / n) * Math.PI;
        const r = s * (0.8 + 0.08 * Math.sin(a * 5 + t * 3) + 0.05 * Math.sin(a * 9 - t * 4));
        const x = Math.cos(a) * r * 1.2;
        const y = Math.sin(a) * r * (0.9 + 0.05 * Math.sin(t * 2)) + s * 0.4;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      eyes([[-s * 0.3, -s * 0.1 + Math.sin(t * 2) * 4], [s * 0.15, -s * 0.18 + Math.cos(t * 2) * 4], [s * 0.45, 0]], s * 0.06);
      // drips
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.6 + i / 3) % 1;
        ctx.fillStyle = color;
        ctx.fillRect(-s * 0.6 + i * s * 0.6, s * 0.4 + k * s * 0.3, 3, 6);
      }
      break;
    }
    case 'sentinel': {
      const sway = Math.sin(t * 1.5) * 0.08;
      ctx.save();
      ctx.rotate(sway * 0.3);
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, -s * 0.9);
      ctx.lineTo(s * 0.3, -s * 0.9);
      ctx.lineTo(s * 0.4, s * 0.7);
      ctx.lineTo(-s * 0.4, s * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // visor
      ctx.fillStyle = color;
      ctx.fillRect(-s * 0.2, -s * 0.7, s * 0.4, s * 0.06);
      // shield
      ctx.fillStyle = '#0c0a18';
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s * 0.3);
      ctx.lineTo(-s * 0.85, -s * 0.2);
      ctx.lineTo(-s * 0.8, s * 0.3);
      ctx.lineTo(-s * 0.5, s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // blade
      ctx.save();
      ctx.translate(s * 0.45, -s * 0.1);
      ctx.rotate(0.45 + Math.sin(t * 2) * 0.25);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -s * 1.0);
      ctx.moveTo(-s * 0.12, -s * 0.08);
      ctx.lineTo(s * 0.12, -s * 0.08);
      ctx.stroke();
      ctx.restore();
      ctx.restore();
      break;
    }
    case 'kraken': {
      for (let i = 0; i < 7; i++) {
        const base = -Math.PI * 0.05 + (i / 6) * Math.PI * 1.1;
        ctx.beginPath();
        let x = Math.cos(base) * s * 0.4;
        let y = Math.sin(base) * s * 0.3;
        ctx.moveTo(x, y);
        for (let k = 1; k <= 10; k++) {
          const a = base + Math.sin(t * 2 + i + k * 0.5) * 0.35;
          x += Math.cos(a) * s * 0.09;
          y += Math.sin(a) * s * 0.09 + 1.5;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.15, s * 0.5, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      eyes([[-s * 0.18, -s * 0.15], [s * 0.18, -s * 0.15]], s * 0.08);
      // glitch blocks
      ctx.fillStyle = color;
      for (let i = 0; i < 4; i++) {
        if (Math.sin(t * 13 + i * 3) > 0.7) ctx.fillRect((Math.sin(i * 9.1) - 0.5) * s * 1.6, (Math.cos(i * 4.7) - 0.3) * s, 10, 4);
      }
      break;
    }
    default: {
      // mimic: a chest whose lid gapes open
      const open = 0.15 + 0.25 * Math.max(0, Math.sin(t * 2.2));
      ctx.beginPath();
      ctx.rect(-s * 0.7, -s * 0.1, s * 1.4, s * 0.7);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.translate(-s * 0.7, -s * 0.1);
      ctx.rotate(-open);
      ctx.beginPath();
      ctx.rect(0, -s * 0.35, s * 1.4, s * 0.35);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        ctx.moveTo(s * 0.1 + i * s * 0.18, 0);
        ctx.lineTo(s * 0.18 + i * s * 0.18, s * 0.12);
        ctx.lineTo(s * 0.26 + i * s * 0.18, 0);
      }
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        ctx.moveTo(-s * 0.6 + i * s * 0.18, -s * 0.1);
        ctx.lineTo(-s * 0.52 + i * s * 0.18, -s * 0.22);
        ctx.lineTo(-s * 0.44 + i * s * 0.18, -s * 0.1);
      }
      ctx.stroke();
      eyes([[-s * 0.25, -s * 0.28 - open * s * 0.3], [s * 0.25, -s * 0.3 - open * s * 0.3]], s * 0.05);
      break;
    }
  }
  noGlow();
}
