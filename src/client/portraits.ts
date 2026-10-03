// Portraits for the story's characters, drawn procedurally so the same art
// works large in the scene and small in the dialogue box.

export type PortraitId = 'oracle' | 'scavenger' | 'kitsune' | 'fixer' | 'wyrm' | 'narrator';

const glowOn = (ctx: CanvasRenderingContext2D, color: string, blur: number) => {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
};

/** Draw a character centred on (x, y), roughly `s` tall. */
export function drawPortrait(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, s: number, t: number, color = '#ff5a3c') {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = Math.max(1.5, s / 60);
  switch (id) {
    case 'oracle': {
      // a veiled figure with one enormous, patient eye
      const breathe = Math.sin(t * 1.2) * s * 0.01;
      glowOn(ctx, '#b48cff', s * 0.12);
      ctx.fillStyle = '#0d0a1a';
      ctx.strokeStyle = '#b48cff';
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.5);
      ctx.quadraticCurveTo(s * 0.34, -s * 0.3, s * 0.4, s * 0.5);
      ctx.lineTo(-s * 0.4, s * 0.5);
      ctx.quadraticCurveTo(-s * 0.34, -s * 0.3, 0, -s * 0.5);
      ctx.fill();
      ctx.stroke();
      // veil folds
      ctx.globalAlpha = 0.5;
      for (const dx of [-0.15, 0, 0.15]) {
        ctx.beginPath();
        ctx.moveTo(dx * s, -s * 0.05);
        ctx.quadraticCurveTo(dx * s * 1.3, s * 0.25, dx * s * 1.6, s * 0.5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const open = 0.75 + 0.25 * Math.sin(t * 0.7);
      glowOn(ctx, '#e7d8ff', s * 0.2);
      ctx.fillStyle = '#e7d8ff';
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.2 + breathe, s * 0.12, s * 0.07 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a1a6a';
      ctx.beginPath();
      ctx.arc(Math.sin(t * 0.5) * s * 0.03, -s * 0.2 + breathe, s * 0.04 * open, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'scavenger': {
      // Rook: hood, scarf, and goggles that catch the light
      glowOn(ctx, '#ffb800', s * 0.06);
      ctx.fillStyle = '#100c08';
      ctx.strokeStyle = '#c98a3a';
      ctx.beginPath();
      ctx.moveTo(-s * 0.36, s * 0.5);
      ctx.quadraticCurveTo(-s * 0.4, -s * 0.05, -s * 0.18, -s * 0.38);
      ctx.quadraticCurveTo(0, -s * 0.52, s * 0.18, -s * 0.38);
      ctx.quadraticCurveTo(s * 0.4, -s * 0.05, s * 0.36, s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1c1510';
      ctx.fillRect(-s * 0.2, -s * 0.06, s * 0.4, s * 0.16);
      ctx.strokeRect(-s * 0.2, -s * 0.06, s * 0.4, s * 0.16);
      const flicker = Math.sin(t * 9) > 0.95 ? 0.4 : 1;
      glowOn(ctx, '#ffb800', s * 0.18 * flicker);
      ctx.fillStyle = `rgba(255, 184, 0, ${flicker})`;
      for (const dx of [-0.08, 0.08]) {
        ctx.beginPath();
        ctx.arc(dx * s, -s * 0.18, s * 0.055, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'kitsune': {
      // a small white fox spirit with three flickering tails
      glowOn(ctx, '#ffffff', s * 0.12);
      ctx.fillStyle = '#f4efe6';
      for (let i = 0; i < 3; i++) {
        const a = -0.9 + i * 0.5 + Math.sin(t * 2 + i) * 0.1;
        ctx.save();
        ctx.translate(s * 0.15, s * 0.2);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(s * 0.22, 0, s * 0.22, s * 0.06, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.ellipse(0, s * 0.18, s * 0.16, s * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.16, -s * 0.05);
      ctx.lineTo(-s * 0.2, -s * 0.3);
      ctx.lineTo(-s * 0.05, -s * 0.12);
      ctx.lineTo(s * 0.05, -s * 0.12);
      ctx.lineTo(s * 0.2, -s * 0.3);
      ctx.lineTo(s * 0.16, -s * 0.05);
      ctx.quadraticCurveTo(0, s * 0.08, -s * 0.16, -s * 0.05);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff2b4f';
      for (const dx of [-0.07, 0.07]) {
        ctx.beginPath();
        ctx.ellipse(dx * s, -s * 0.06, s * 0.025, s * 0.015, dx > 0 ? -0.4 : 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fixer': {
      // a silhouette in a hat, one cybernetic eye
      ctx.fillStyle = '#0a0a10';
      ctx.strokeStyle = '#00f0ff';
      glowOn(ctx, '#00f0ff', s * 0.05);
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.15, s * 0.16, s * 0.2, 0, 0, Math.PI * 2);
      ctx.moveTo(-s * 0.34, s * 0.5);
      ctx.quadraticCurveTo(0, -s * 0.05, s * 0.34, s * 0.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(-s * 0.3, -s * 0.36, s * 0.6, s * 0.05);
      ctx.fillRect(-s * 0.17, -s * 0.52, s * 0.34, s * 0.18);
      glowOn(ctx, '#ff2bd6', s * 0.15);
      ctx.fillStyle = '#ff2bd6';
      ctx.beginPath();
      ctx.arc(s * 0.06, -s * 0.15, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'wyrm': {
      // a wyrm's head in profile
      glowOn(ctx, color, s * 0.1);
      ctx.fillStyle = '#0c0812';
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(s * 0.35, -s * 0.2);
      ctx.quadraticCurveTo(-s * 0.1, -s * 0.3, -s * 0.45, -s * 0.02);
      ctx.lineTo(-s * 0.1, s * 0.06);
      ctx.lineTo(-s * 0.4, s * 0.12);
      ctx.quadraticCurveTo(0, s * 0.3, s * 0.35, s * 0.2);
      ctx.quadraticCurveTo(s * 0.5, 0, s * 0.35, -s * 0.2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s * 0.2, -s * 0.22);
      ctx.quadraticCurveTo(s * 0.4, -s * 0.5, s * 0.55, -s * 0.48);
      ctx.stroke();
      glowOn(ctx, color, s * 0.2);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(-s * 0.08, -s * 0.1, s * 0.07, s * 0.035, -0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      // the narrator: a single candle flame, the last light
      const f = 1 + Math.sin(t * 7) * 0.05 + Math.sin(t * 13) * 0.03;
      glowOn(ctx, '#ffb800', s * 0.35);
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.32 * f);
      ctx.quadraticCurveTo(s * 0.16, -s * 0.02, 0, s * 0.12);
      ctx.quadraticCurveTo(-s * 0.16, -s * 0.02, 0, -s * 0.32 * f);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#5a4630';
      ctx.fillRect(-s * 0.1, s * 0.12, s * 0.2, s * 0.32);
    }
  }
  ctx.restore();
}

const cache = new Map<string, string>();

/** A small still portrait for the dialogue box. */
export function portraitDataUrl(id: string, color?: string): string {
  const key = `${id}:${color ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  drawPortrait(c.getContext('2d')!, id, 48, 50, 84, 1.3, color);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
