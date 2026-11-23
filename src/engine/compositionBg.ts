import type { CompositionLayer, CompositionState } from '../types/puppet';

/**
 * Returns all composition layers strictly BELOW the active Puppet Solid Layer,
 * ordered bottom-to-top for canvas compositing (in After Effects, index 0 is topmost).
 * Filters by layer visibility, solo state among below-layers, and active frame range.
 */
export function getBelowCompositionLayers(
  composition: CompositionState,
  activeLayerId?: string
): CompositionLayer[] {
  const targetId =
    activeLayerId ??
    composition.selectedLayerId ??
    composition.layers.find((l) => l.effect !== null)?.id;

  let activeIdx = composition.layers.findIndex((l) => l.id === targetId);
  if (activeIdx < 0) {
    activeIdx = composition.layers.findIndex((l) => l.effect !== null);
  }
  if (activeIdx < 0) {
    return [];
  }

  const below = composition.layers.slice(activeIdx + 1);
  if (below.length === 0) return [];

  const hasSoloBelow = below.some((l) => l.solo);

  return below
    .filter(
      (layer) =>
        layer.visible &&
        (!hasSoloBelow || layer.solo) &&
        composition.currentFrame >= layer.inFrame &&
        composition.currentFrame <= layer.outFrame
    )
    .reverse();
}

const checkerboardTileCache = new Map<string, HTMLCanvasElement>();

/**
 * Draws a crisp transparency checkerboard strictly inside the specified rectangle.
 * Uses a cached 2×2 tile CanvasPattern for O(1) full-viewport rendering performance.
 */
export function drawCheckerboardRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cellSize = 14,
  darkColor = '#1E1E1E',
  lightColor = '#2B2B2B'
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  if (typeof document !== 'undefined') {
    const key = `${cellSize}:${darkColor}:${lightColor}`;
    let tile = checkerboardTileCache.get(key);
    if (!tile) {
      tile = document.createElement('canvas');
      tile.width = cellSize * 2;
      tile.height = cellSize * 2;
      const tctx = tile.getContext('2d');
      if (tctx) {
        tctx.fillStyle = darkColor;
        tctx.fillRect(0, 0, tile.width, tile.height);
        tctx.fillStyle = lightColor;
        tctx.fillRect(0, 0, cellSize, cellSize);
        tctx.fillRect(cellSize, cellSize, cellSize, cellSize);
      }
      checkerboardTileCache.set(key, tile);
    }
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) {
      ctx.translate(x, y);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      return;
    }
  }

  ctx.fillStyle = darkColor;
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = lightColor;
  const cols = Math.ceil(w / cellSize);
  const rows = Math.ceil(h / cellSize);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 === 0) {
        ctx.fillRect(x + c * cellSize, y + r * cellSize, cellSize, cellSize);
      }
    }
  }

  ctx.restore();
}

/**
 * Renders a non-puppet After Effects composition layer (Backdrop or Solid) inside (x, y, w, h).
 * Shared between the AE Composition Host and the Plugin Window's "Use After Effects Composition"
 * background mode so both match 1:1.
 */
export function drawCompositionBackdropLayer(
  ctx: CanvasRenderingContext2D,
  layer: CompositionLayer,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity / 100));

  if (layer.type === 'backdrop') {
    // Rich AE studio cyclorama gradient + subtle stage horizon grid
    const grad = ctx.createRadialGradient(
      x + w * 0.5,
      y + h * 0.42,
      h * 0.04,
      x + w * 0.5,
      y + h * 0.5,
      w * 0.68
    );
    grad.addColorStop(0, '#2B364B');
    grad.addColorStop(0.55, '#1D2434');
    grad.addColorStop(1, layer.solidColor || '#131720');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // Subtle studio floor horizon & perspective stage lines
    const horizonY = y + h * 0.76;
    const floorGrad = ctx.createLinearGradient(0, horizonY, 0, y + h);
    floorGrad.addColorStop(0, 'rgba(13, 17, 26, 0.42)');
    floorGrad.addColorStop(1, 'rgba(8, 10, 16, 0.72)');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(x, horizonY, w, y + h - horizonY);

    ctx.strokeStyle = 'rgba(147, 197, 253, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, horizonY);
    ctx.lineTo(x + w, horizonY);
    ctx.stroke();

    // Subtle perspective grid lines on the studio floor
    ctx.strokeStyle = 'rgba(147, 197, 253, 0.08)';
    const vanishX = x + w * 0.5;
    const vanishY = horizonY - h * 0.14;
    for (let i = -5; i <= 5; i++) {
      const bottomX = vanishX + i * (w * 0.13);
      const t = (horizonY - vanishY) / (y + h - vanishY);
      const topX = vanishX + (bottomX - vanishX) * t;
      ctx.beginPath();
      ctx.moveTo(topX, horizonY);
      ctx.lineTo(bottomX, y + h);
      ctx.stroke();
    }
    for (let r = 1; r <= 3; r++) {
      const ry = horizonY + (y + h - horizonY) * Math.pow(r / 3.5, 1.5);
      ctx.beginPath();
      ctx.moveTo(x, ry);
      ctx.lineTo(x + w, ry);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = layer.solidColor;
    ctx.fillRect(x, y, w, h);
  }

  ctx.restore();
}
