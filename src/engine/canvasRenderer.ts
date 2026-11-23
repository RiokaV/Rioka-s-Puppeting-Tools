import type {
  ArtMeshLayer,
  DeformerNode,
  EvaluatedRigResult,
  PhysicsGroup,
  PhysicsSimulationState,
  PuppetDocument,
  StudioToolId,
} from '../types/puppet';
import {
  buildDeformedMeshVertices,
  computeEffectiveLayerOpacity,
  getLayerNonBoneWorldRotationDeg,
  transformLayerPointToModel,
  type MeshVertex,
} from './rigging';
import {
  computeBoneGizmoGeometry,
  computeMorphPinGizmoGeometry,
  isMorphPinMoved,
} from './morphTools';
import { cacheManager } from './cacheManager';

interface CachedTexture {
  img: HTMLImageElement;
  bitmap: HTMLCanvasElement | null;
  ready: boolean;
}

const textureCache = new Map<string, CachedTexture>();

/**
 * Purges all cached offscreen rasterized PSD textures (invoked by Edit -> Purge -> All Memory & Disk Cache).
 */
export function clearTextureBitmapCache(): void {
  textureCache.clear();
}

export function getOrLoadLayerBitmap(
  dataUrl: string
): HTMLCanvasElement | HTMLImageElement | null {
  if (!dataUrl) return null;
  const cached = textureCache.get(dataUrl);
  if (cached) {
    if (cached.bitmap) return cached.bitmap;
    if (cached.ready && cached.img.naturalWidth > 0) return cached.img;
    return null;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  const entry: CachedTexture = { img, bitmap: null, ready: false };
  textureCache.set(dataUrl, entry);

  const bakeBitmap = () => {
    const w = img.naturalWidth || 256;
    const h = img.naturalHeight || 256;
    if (typeof document !== 'undefined' && w > 0 && h > 0) {
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d');
      if (octx) {
        octx.drawImage(img, 0, 0, w, h);
        entry.bitmap = off;
        cacheManager.registerTexture(dataUrl.slice(0, 96), w, h);
      }
    }
    entry.ready = true;
  };

  img.onload = bakeBitmap;
  img.src = dataUrl;
  if (img.complete && img.naturalWidth > 0) {
    bakeBitmap();
    return entry.bitmap ?? img;
  }
  return null;
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement | HTMLImageElement,
  x0: number,
  y0: number,
  u0: number,
  v0: number,
  x1: number,
  y1: number,
  u1: number,
  v1: number,
  x2: number,
  y2: number,
  u2: number,
  v2: number
): void {
  const denom = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
  if (Math.abs(denom) < 1e-5) return;

  const cx = (x0 + x1 + x2) / 3;
  const cy = (y0 + y1 + y2) / 3;
  const expand = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * 0.65, y + (dy / len) * 0.65];
  };
  const [ex0, ey0] = expand(x0, y0);
  const [ex1, ey1] = expand(x1, y1);
  const [ex2, ey2] = expand(x2, y2);

  const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / denom;
  const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / denom;
  const c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / denom;
  const d = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / denom;
  const e =
    (x0 * (u1 * v2 - u2 * v1) +
      x1 * (u2 * v0 - u0 * v2) +
      x2 * (u0 * v1 - u1 * v0)) /
    denom;
  const f =
    (y0 * (u1 * v2 - u2 * v1) +
      y1 * (u2 * v0 - u0 * v2) +
      y2 * (u0 * v1 - u1 * v0)) /
    denom;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ex0, ey0);
  ctx.lineTo(ex1, ey1);
  ctx.lineTo(ex2, ey2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

function isLayerPurelyAffine(
  layer: ArtMeshLayer,
  deformersById: Record<string, DeformerNode>,
  rigResult: EvaluatedRigResult
): boolean {
  for (const off of layer.vertexOffsets) {
    if (Math.abs(off.dx) > 0.05 || Math.abs(off.dy) > 0.05) return false;
  }
  if (layer.morphPins) {
    for (const pin of layer.morphPins) {
      if (isMorphPinMoved(pin)) return false;
    }
  }
  if (layer.basicLattice) {
    for (const off of layer.basicLattice.offsets) {
      if (Math.abs(off.dx) > 0.05 || Math.abs(off.dy) > 0.05) return false;
    }
  }
  const lw = rigResult.layerTransforms[layer.id]?.meshWarp;
  if (
    lw &&
    (Math.abs(lw.bendX) > 0.005 ||
      Math.abs(lw.bendY) > 0.005 ||
      Math.abs(lw.squeezeX) > 0.005 ||
      Math.abs(lw.squeezeY) > 0.005)
  ) {
    return false;
  }

  let cursor: DeformerNode | undefined = deformersById[layer.parentDeformerId];
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    const dw = rigResult.deformerTransforms[cursor.id]?.meshWarp;
    if (
      dw &&
      (Math.abs(dw.bendX) > 0.005 ||
        Math.abs(dw.bendY) > 0.005 ||
        Math.abs(dw.squeezeX) > 0.005 ||
        Math.abs(dw.squeezeY) > 0.005)
    ) {
      return false;
    }
    cursor = cursor.parentId ? deformersById[cursor.parentId] : undefined;
  }
  return true;
}

export interface PuppetRenderOptions {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotationDeg?: number;
  activeTool?: StudioToolId;
  showMeshWireframe?: boolean;
  showDeformerCage?: boolean;
  showPhysicsOverlay?: boolean;
  selectedLayerId?: string | null;
  selectedDeformerId?: string | null;
  selectedPhysicsGroupId?: string | null;
  selectedPinId?: string | null;
  activePinDragKind?: 'move' | 'rotate' | 'scale' | null;
  brushCursor?: {
    x: number; // model space
    y: number;
    radius: number;
    hardness: number;
    visible: boolean;
  };
}

export function renderPuppetToCanvas(
  ctx: CanvasRenderingContext2D,
  puppet: PuppetDocument,
  rigResult: EvaluatedRigResult,
  physicsGroups: PhysicsGroup[],
  physicsState: PhysicsSimulationState,
  opts: PuppetRenderOptions
): void {
  const deformersById: Record<string, DeformerNode> = {};
  for (const d of puppet.deformers) {
    deformersById[d.id] = d;
  }
  const layersById: Record<string, ArtMeshLayer> = {};
  for (const l of puppet.layers) {
    layersById[l.id] = l;
  }

  ctx.save();
  ctx.translate(opts.offsetX, opts.offsetY);
  if (opts.rotationDeg) {
    ctx.rotate((opts.rotationDeg * Math.PI) / 180);
  }
  ctx.scale(opts.scale, opts.scale);
  ctx.translate(-puppet.modelWidth * 0.5, -puppet.modelHeight * 0.5);

  const sortedLayers = [...puppet.layers].sort((a, b) => a.zIndex - b.zIndex);
  const wireframeCache: Array<{
    layer: ArtMeshLayer;
    vertices: MeshVertex[];
  }> = [];

  for (const layer of sortedLayers) {
    if (!layer.visible) continue;
    const opacity = computeEffectiveLayerOpacity(layer, deformersById, rigResult);
    if (opacity <= 0.005) continue;

    const source = getOrLoadLayerBitmap(layer.textureDataUrl);
    const vertices = buildDeformedMeshVertices(
      layer,
      deformersById,
      rigResult,
      layersById
    );

    if (
      opts.showMeshWireframe ||
      ((opts.activeTool === 'mesh_create' ||
        opts.activeTool === 'add_morph_point' ||
        opts.activeTool === 'brush_morph') &&
        opts.selectedLayerId === layer.id)
    ) {
      wireframeCache.push({ layer, vertices });
    }

    if (!source) continue;

    const imgW =
      source instanceof HTMLCanvasElement
        ? source.width
        : source.naturalWidth || layer.width;
    const imgH =
      source instanceof HTMLCanvasElement
        ? source.height
        : source.naturalHeight || layer.height;
    const cols = Math.max(1, layer.meshCols);
    const rows = Math.max(1, layer.meshRows);

    ctx.save();
    ctx.globalAlpha *= opacity;

    if (isLayerPurelyAffine(layer, deformersById, rigResult)) {
      const tl = vertices[0];
      const tr = vertices[cols];
      const bl = vertices[rows * (cols + 1)];
      const a = (tr.x - tl.x) / imgW;
      const b = (tr.y - tl.y) / imgW;
      const c = (bl.x - tl.x) / imgH;
      const d = (bl.y - tl.y) / imgH;
      ctx.transform(a, b, c, d, tl.x, tl.y);
      ctx.drawImage(source, 0, 0);
    } else {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i00 = r * (cols + 1) + c;
          const i10 = i00 + 1;
          const i01 = (r + 1) * (cols + 1) + c;
          const i11 = i01 + 1;

          const v00 = vertices[i00];
          const v10 = vertices[i10];
          const v01 = vertices[i01];
          const v11 = vertices[i11];

          drawTexturedTriangle(
            ctx,
            source,
            v00.x,
            v00.y,
            v00.u * imgW,
            v00.v * imgH,
            v10.x,
            v10.y,
            v10.u * imgW,
            v10.v * imgH,
            v11.x,
            v11.y,
            v11.u * imgW,
            v11.v * imgH
          );
          drawTexturedTriangle(
            ctx,
            source,
            v00.x,
            v00.y,
            v00.u * imgW,
            v00.v * imgH,
            v11.x,
            v11.y,
            v11.u * imgW,
            v11.v * imgH,
            v01.x,
            v01.y,
            v01.u * imgW,
            v01.v * imgH
          );
        }
      }
    }

    ctx.restore();
  }

  // ArtMesh Wireframe Overlay
  for (const { layer, vertices } of wireframeCache) {
    const isSelected = opts.selectedLayerId === layer.id;
    const cols = Math.max(1, layer.meshCols);
    const rows = Math.max(1, layer.meshRows);

    ctx.save();
    ctx.strokeStyle = isSelected
      ? 'rgba(45, 140, 235, 0.92)'
      : 'rgba(160, 170, 185, 0.25)';
    ctx.lineWidth = (isSelected ? 1.4 : 0.8) / opts.scale;

    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i00 = r * (cols + 1) + c;
        const i10 = i00 + 1;
        const i01 = (r + 1) * (cols + 1) + c;
        const i11 = i01 + 1;
        const v00 = vertices[i00];
        const v10 = vertices[i10];
        const v01 = vertices[i01];
        const v11 = vertices[i11];

        ctx.moveTo(v00.x, v00.y);
        ctx.lineTo(v10.x, v10.y);
        ctx.lineTo(v11.x, v11.y);
        ctx.lineTo(v01.x, v01.y);
        ctx.closePath();
        ctx.moveTo(v00.x, v00.y);
        ctx.lineTo(v11.x, v11.y);
      }
    }
    ctx.stroke();

    if (isSelected) {
      ctx.fillStyle = '#2D8CEB';
      const dotR = 2.6 / opts.scale;
      for (const v of vertices) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  const selectedLayer = opts.selectedLayerId
    ? puppet.layers.find((l) => l.id === opts.selectedLayerId)
    : undefined;

  // Tool Overlay: Custom Morph Pin Points (Add Morph Point & Main Cursor Advanced Pin Gizmo)
  if (
    selectedLayer &&
    (opts.activeTool === 'cursor' || opts.activeTool === 'add_morph_point') &&
    selectedLayer.morphPins &&
    selectedLayer.morphPins.length > 0
  ) {
    const halfW = selectedLayer.width * 0.5;
    const halfH = selectedLayer.height * 0.5;
    const invS = 1 / Math.max(0.05, opts.scale);
    const isPlaceMode = opts.activeTool === 'add_morph_point';
    const baseRotDeg = getLayerNonBoneWorldRotationDeg(
      selectedLayer,
      deformersById,
      rigResult,
      layersById
    ) + (selectedLayer.boneTransform?.rotation ?? 0);

    const activePinId =
      opts.selectedPinId &&
      selectedLayer.morphPins.some((p) => p.id === opts.selectedPinId)
        ? opts.selectedPinId
        : selectedLayer.morphPins[selectedLayer.morphPins.length - 1].id;

    // Render non-active pins first, then active pin on top so its handles stay unobstructed
    const orderedPins = [
      ...selectedLayer.morphPins.filter((p) => p.id !== activePinId),
      ...selectedLayer.morphPins.filter((p) => p.id === activePinId),
    ];

    ctx.save();
    for (const pin of orderedPins) {
      const restLocal = {
        x: selectedLayer.x - halfW + pin.restU * selectedLayer.width,
        y: selectedLayer.y - halfH + pin.restV * selectedLayer.height,
      };
      const targetLocal = {
        x: restLocal.x + pin.dx,
        y: restLocal.y + pin.dy,
      };
      const restW = transformLayerPointToModel(
        restLocal,
        selectedLayer,
        deformersById,
        rigResult,
        layersById
      );
      const targetW = transformLayerPointToModel(
        targetLocal,
        selectedLayer,
        deformersById,
        rigResult,
        layersById
      );

      const moved = isMorphPinMoved(pin);

      // Subtle tether from rest position to moved pin position
      if (Math.hypot(targetW.x - restW.x, targetW.y - restW.y) > 1) {
        ctx.strokeStyle = 'rgba(117, 220, 107, 0.58)';
        ctx.lineWidth = 1.3 * invS;
        ctx.setLineDash([4 * invS, 3 * invS]);
        ctx.beginPath();
        ctx.moveTo(restW.x, restW.y);
        ctx.lineTo(targetW.x, targetW.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Small rest anchor dot
        ctx.fillStyle = 'rgba(117, 220, 107, 0.45)';
        ctx.beginPath();
        ctx.arc(restW.x, restW.y, 2.5 * invS, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isPlaceMode) {
        // Rest placement mode: crisp green dot with white center pinhole
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.beginPath();
        ctx.arc(targetW.x + 1.2 * invS, targetW.y + 1.2 * invS, 6.2 * invS, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#75DC6B';
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 1.6 * invS;
        ctx.beginPath();
        ctx.arc(targetW.x, targetW.y, 6.2 * invS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(targetW.x, targetW.y, 2.1 * invS, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      const isActive = pin.id === activePinId;
      if (!isActive) {
        // Inactive pin in Main Cursor mode: crisp green dot (unmoved pins show subtle anchor ring)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.beginPath();
        ctx.arc(targetW.x + 1.4 * invS, targetW.y + 1.4 * invS, 5.8 * invS, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#75DC6B';
        ctx.strokeStyle = moved ? '#2A5B25' : '#183815';
        ctx.lineWidth = 1.2 * invS;
        ctx.beginPath();
        ctx.arc(targetW.x, targetW.y, 5.8 * invS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (!moved) {
          // Subtle inner anchor ring indicating this unmoved pin locks the mesh in place
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
          ctx.lineWidth = 1.0 * invS;
          ctx.beginPath();
          ctx.arc(targetW.x, targetW.y, 3.0 * invS, 0, Math.PI * 2);
          ctx.stroke();
        }
        continue;
      }

      // Active pin in Main Cursor mode: AE-style Advanced Pin Gizmo
      // (Center green dot = Move, Outer green ring + hollow green square = Rotate, Filled blue square = Scale)
      const pinRot = pin.rotation ?? 0;
      const pinScale = pin.scale ?? 1;
      const geom = computeMorphPinGizmoGeometry(
        targetW,
        pinRot,
        pinScale,
        opts.scale,
        baseRotDeg
      );

      // 1) Outer thin green circle ring with clean transparent gap behind the hollow green scale box
      const gapHalfAngle = Math.atan2(geom.scaleBoxHalf + 0.6 * invS, geom.ringRadius);
      ctx.strokeStyle =
        opts.activePinDragKind === 'rotate' || opts.activePinDragKind === 'scale'
          ? '#9AF091'
          : '#75DC6B';
      ctx.lineWidth =
        (opts.activePinDragKind === 'rotate' || opts.activePinDragKind === 'scale'
          ? 2.0
          : 1.45) * invS;
      ctx.beginPath();
      ctx.arc(
        geom.centerX,
        geom.centerY,
        geom.ringRadius,
        geom.angleRad + gapHalfAngle,
        geom.angleRad + Math.PI * 2 - gapHalfAngle
      );
      ctx.stroke();

      // 2) Hollow green square handle ON the outer ring (Scale up/down)
      const boxAngle = geom.angleRad + Math.PI * 0.5;
      ctx.save();
      ctx.translate(geom.scaleBoxX, geom.scaleBoxY);
      ctx.rotate(boxAngle);
      const sbHalf = geom.scaleBoxHalf;
      // Subtle dark outer shadow for legibility on light artwork
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 3.2 * invS;
      ctx.strokeRect(-sbHalf, -sbHalf, sbHalf * 2, sbHalf * 2);
      // Crisp hollow green square
      ctx.strokeStyle =
        opts.activePinDragKind === 'scale' ? '#A8F5A0' : '#75DC6B';
      ctx.lineWidth = (opts.activePinDragKind === 'scale' ? 2.2 : 1.75) * invS;
      ctx.strokeRect(-sbHalf, -sbHalf, sbHalf * 2, sbHalf * 2);
      ctx.restore();

      // 3) Filled cornflower-blue square handle inside ring along axis (Rotate)
      ctx.save();
      ctx.translate(geom.rotHandleX, geom.rotHandleY);
      ctx.rotate(boxAngle);
      const rHalf = geom.rotSquareHalf;
      // Drop shadow matching reference screenshot
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(
        -rHalf + 1.3 * invS,
        -rHalf + 1.4 * invS,
        rHalf * 2,
        rHalf * 2
      );
      ctx.fillStyle =
        opts.activePinDragKind === 'rotate' ? '#8196FF' : '#647BF2';
      ctx.fillRect(-rHalf, -rHalf, rHalf * 2, rHalf * 2);
      if (opts.activePinDragKind === 'rotate') {
        ctx.strokeStyle = '#E0E7FF';
        ctx.lineWidth = 1.1 * invS;
        ctx.strokeRect(-rHalf, -rHalf, rHalf * 2, rHalf * 2);
      }
      ctx.restore();

      // 4) Center filled green circle dot (Move) with subtle drop shadow & inner ring
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.beginPath();
      ctx.arc(
        geom.centerX + 1.5 * invS,
        geom.centerY + 1.5 * invS,
        geom.centerDotRadius,
        0,
        Math.PI * 2
      );
      ctx.fill();

      ctx.fillStyle =
        opts.activePinDragKind === 'move' ? '#95EB8C' : '#75DC6B';
      ctx.beginPath();
      ctx.arc(geom.centerX, geom.centerY, geom.centerDotRadius, 0, Math.PI * 2);
      ctx.fill();

      // Subtle inner ring accent matching the screenshot's green center pin bead
      ctx.strokeStyle = 'rgba(42, 110, 36, 0.35)';
      ctx.lineWidth = 1.0 * invS;
      ctx.beginPath();
      ctx.arc(
        geom.centerX,
        geom.centerY,
        geom.centerDotRadius * 0.68,
        0,
        Math.PI * 2
      );
      ctx.stroke();

      // 5) Live compact HUD readout ONLY while actively dragging move/rotate/scale
      if (opts.activePinDragKind) {
        const label =
          opts.activePinDragKind === 'move'
            ? `Pos ${Math.round(pin.dx)}, ${Math.round(pin.dy)}`
            : opts.activePinDragKind === 'rotate'
              ? `Rot ${pinRot.toFixed(1)}°`
              : `Scale ${Math.round(pinScale * 100)}%`;
        const fontPx = Math.max(9, Math.round(10.5 * invS));
        ctx.font = `600 ${fontPx}px "JetBrains Mono", ui-monospace, monospace`;
        const textW = ctx.measureText(label).width;
        const padX = 5 * invS;
        const boxH = 16 * invS;
        const boxX = geom.centerX + geom.ringRadius + 10 * invS;
        const boxY = geom.centerY - boxH * 0.5;
        ctx.fillStyle = 'rgba(18, 20, 26, 0.86)';
        ctx.strokeStyle =
          opts.activePinDragKind === 'rotate'
            ? 'rgba(100, 123, 242, 0.8)'
            : 'rgba(117, 220, 107, 0.75)';
        ctx.lineWidth = 1.1 * invS;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, textW + padX * 2, boxH, 3 * invS);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#F0FDF4';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, boxX + padX, boxY + boxH * 0.52);
      }
    }
    ctx.restore();
  }

  // Tool Overlay: Bone Tool (Visual Parent-Child Bone Chains + Null Object Circle + Upward Arrow)
  if (opts.activeTool === 'bone_create') {
    const invS = 1 / Math.max(0.05, opts.scale);

    // Draw parent -> child bone connector lines across all parented layers
    const getLayerPivotW = (l: ArtMeshLayer) => {
      const hw = l.width * 0.5;
      const hh = l.height * 0.5;
      return transformLayerPointToModel(
        { x: l.x - hw + l.width * l.pivotX, y: l.y - hh + l.height * l.pivotY },
        l,
        deformersById,
        rigResult,
        layersById
      );
    };

    ctx.save();
    for (const childLayer of puppet.layers) {
      if (!childLayer.parentLayerId) continue;
      const parentLayer = layersById[childLayer.parentLayerId];
      if (!parentLayer) continue;
      const pW = getLayerPivotW(parentLayer);
      const cW = getLayerPivotW(childLayer);
      const isActiveChain =
        selectedLayer &&
        (selectedLayer.id === childLayer.id || selectedLayer.id === parentLayer.id);

      const dx = cW.x - pW.x;
      const dy = cW.y - pW.y;
      const len = Math.hypot(dx, dy);
      if (len > 2) {
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;
        const baseW = (isActiveChain ? 6 : 4) * invS;

        // Tapered rigging bone diamond/kite connecting parent pivot to child pivot
        ctx.fillStyle = isActiveChain
          ? 'rgba(245, 158, 11, 0.24)'
          : 'rgba(148, 163, 184, 0.14)';
        ctx.strokeStyle = isActiveChain
          ? 'rgba(251, 191, 36, 0.92)'
          : 'rgba(148, 163, 184, 0.55)';
        ctx.lineWidth = (isActiveChain ? 1.8 : 1.2) * invS;
        ctx.beginPath();
        ctx.moveTo(pW.x, pW.y);
        ctx.lineTo(pW.x + ux * (len * 0.22) + px * baseW, pW.y + uy * (len * 0.22) + py * baseW);
        ctx.lineTo(cW.x, cW.y);
        ctx.lineTo(pW.x + ux * (len * 0.22) - px * baseW, pW.y + uy * (len * 0.22) - py * baseW);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Small joint circle at non-selected endpoint
        const jointR = 4.2 * invS;
        ctx.fillStyle = isActiveChain ? '#F59E0B' : '#94A3B8';
        ctx.strokeStyle = '#0F1115';
        ctx.lineWidth = 1.2 * invS;
        for (const pt of [pW, cW]) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, jointR, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  if (selectedLayer && opts.activeTool === 'bone_create') {
    const halfW = selectedLayer.width * 0.5;
    const halfH = selectedLayer.height * 0.5;
    const pivotLocal = {
      x: selectedLayer.x - halfW + selectedLayer.width * selectedLayer.pivotX,
      y: selectedLayer.y - halfH + selectedLayer.height * selectedLayer.pivotY,
    };
    const pivotW = transformLayerPointToModel(
      pivotLocal,
      selectedLayer,
      deformersById,
      rigResult,
      layersById
    );

    const cornersLocal = [
      { x: selectedLayer.x - halfW, y: selectedLayer.y - halfH },
      { x: selectedLayer.x + halfW, y: selectedLayer.y - halfH },
      { x: selectedLayer.x + halfW, y: selectedLayer.y + halfH },
      { x: selectedLayer.x - halfW, y: selectedLayer.y + halfH },
    ].map((p) =>
      transformLayerPointToModel(
        p,
        selectedLayer,
        deformersById,
        rigResult,
        layersById
      )
    );

    const baseRotDeg = getLayerNonBoneWorldRotationDeg(
      selectedLayer,
      deformersById,
      rigResult,
      layersById
    );
    const boneRot = selectedLayer.boneTransform?.rotation ?? 0;
    const boneScale = selectedLayer.boneTransform?.scaleX ?? 1;
    const geom = computeBoneGizmoGeometry(pivotW, boneRot, boneScale, baseRotDeg);

    const invS = 1 / Math.max(0.05, opts.scale);
    const circleR = 13 * invS;
    const headLen = 16 * invS;
    const headHalfW = 8.5 * invS;

    ctx.save();

    // Subtle dashed selection outline around the selected layer
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
    ctx.lineWidth = 1.25 * invS;
    ctx.setLineDash([6 * invS, 4 * invS]);
    ctx.beginPath();
    ctx.moveTo(cornersLocal[0].x, cornersLocal[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(cornersLocal[i].x, cornersLocal[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Upward Rotation & Scale Arrow (starts at circle edge, extends to tip)
    const dirX = Math.cos(geom.angleRad);
    const dirY = Math.sin(geom.angleRad);
    const perpX = -dirY;
    const perpY = dirX;
    const shaftStartX = geom.pivotX + dirX * circleR;
    const shaftStartY = geom.pivotY + dirY * circleR;
    const shaftEndX = geom.tipX - dirX * (headLen * 0.72);
    const shaftEndY = geom.tipY - dirY * (headLen * 0.72);

    // Dark contrast backing for shaft
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(10, 12, 16, 0.85)';
    ctx.lineWidth = 5.4 * invS;
    ctx.beginPath();
    ctx.moveTo(shaftStartX, shaftStartY);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();

    // Sky-blue shaft
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2.6 * invS;
    ctx.beginPath();
    ctx.moveTo(shaftStartX, shaftStartY);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();

    // Subtle interactive grab halo around the arrow tip
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 1.2 * invS;
    ctx.beginPath();
    ctx.arc(geom.tipX, geom.tipY, 13 * invS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Crisp triangular arrowhead pointing in the arrow direction
    const baseCenterX = geom.tipX - dirX * headLen;
    const baseCenterY = geom.tipY - dirY * headLen;
    ctx.fillStyle = '#38BDF8';
    ctx.strokeStyle = '#0B0F17';
    ctx.lineWidth = 1.8 * invS;
    ctx.beginPath();
    ctx.moveTo(geom.tipX + dirX * (2 * invS), geom.tipY + dirY * (2 * invS));
    ctx.lineTo(
      baseCenterX + perpX * headHalfW,
      baseCenterY + perpY * headHalfW
    );
    ctx.lineTo(
      baseCenterX - perpX * headHalfW,
      baseCenterY - perpY * headHalfW
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Null Object Circle (Move Handle / Alt+Drag Anchor)
    ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
    ctx.strokeStyle = 'rgba(10, 12, 16, 0.9)';
    ctx.lineWidth = 5 * invS;
    ctx.beginPath();
    ctx.arc(geom.pivotX, geom.pivotY, circleR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2.4 * invS;
    ctx.beginPath();
    ctx.arc(geom.pivotX, geom.pivotY, circleR, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle inner null-object crosshair ticks + center dot
    const tickIn = 4.5 * invS;
    const tickOut = 10.5 * invS;
    ctx.strokeStyle = 'rgba(255, 243, 214, 0.85)';
    ctx.lineWidth = 1.3 * invS;
    ctx.beginPath();
    ctx.moveTo(geom.pivotX - tickOut, geom.pivotY);
    ctx.lineTo(geom.pivotX - tickIn, geom.pivotY);
    ctx.moveTo(geom.pivotX + tickIn, geom.pivotY);
    ctx.lineTo(geom.pivotX + tickOut, geom.pivotY);
    ctx.moveTo(geom.pivotX, geom.pivotY - tickOut);
    ctx.lineTo(geom.pivotX, geom.pivotY - tickIn);
    ctx.moveTo(geom.pivotX, geom.pivotY + tickIn);
    ctx.lineTo(geom.pivotX, geom.pivotY + tickOut);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(geom.pivotX, geom.pivotY, 2.5 * invS, 0, Math.PI * 2);
    ctx.fill();

    // Compact on-canvas numeric readout next to arrow tip
    const readout = `${Math.round(boneRot)}° · ${Math.round(boneScale * 100)}%`;
    const fontPx = Math.max(9, Math.round(10.5 * invS));
    ctx.font = `600 ${fontPx}px "JetBrains Mono", ui-monospace, monospace`;
    const textW = ctx.measureText(readout).width;
    const padX = 5 * invS;
    const boxH = 16 * invS;
    const boxX = geom.tipX + 16 * invS;
    const boxY = geom.tipY - boxH * 0.5;
    ctx.fillStyle = 'rgba(18, 20, 26, 0.82)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1 * invS;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, textW + padX * 2, boxH, 3 * invS);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#E0F2FE';
    ctx.textBaseline = 'middle';
    ctx.fillText(readout, boxX + padX, boxY + boxH * 0.52);

    ctx.restore();
  }

  // Tool Overlay: Basic Morphing (Adjustable Lattice Grid Box)
  if (
    selectedLayer &&
    opts.activeTool === 'basic_morph' &&
    selectedLayer.basicLattice
  ) {
    const lat = selectedLayer.basicLattice;
    const halfW = selectedLayer.width * 0.5;
    const halfH = selectedLayer.height * 0.5;
    const pts: Array<{ x: number; y: number }> = [];

    for (let r = 0; r <= lat.rows; r++) {
      const v = r / lat.rows;
      for (let c = 0; c <= lat.cols; c++) {
        const u = c / lat.cols;
        const idx = r * (lat.cols + 1) + c;
        const off = lat.offsets[idx] ?? { dx: 0, dy: 0 };
        const lp = {
          x: selectedLayer.x - halfW + u * selectedLayer.width + off.dx,
          y: selectedLayer.y - halfH + v * selectedLayer.height + off.dy,
        };
        pts.push(
          transformLayerPointToModel(lp, selectedLayer, deformersById, rigResult)
        );
      }
    }

    ctx.save();
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 1.6 / opts.scale;
    ctx.beginPath();
    for (let r = 0; r <= lat.rows; r++) {
      for (let c = 0; c < lat.cols; c++) {
        const a = pts[r * (lat.cols + 1) + c];
        const b = pts[r * (lat.cols + 1) + c + 1];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    for (let c = 0; c <= lat.cols; c++) {
      for (let r = 0; r < lat.rows; r++) {
        const a = pts[r * (lat.cols + 1) + c];
        const b = pts[(r + 1) * (lat.cols + 1) + c];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();

    const hr = 5 / opts.scale;
    for (const p of pts) {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#2D8CEB';
      ctx.lineWidth = 1.8 / opts.scale;
      ctx.fillRect(p.x - hr, p.y - hr, hr * 2, hr * 2);
      ctx.strokeRect(p.x - hr, p.y - hr, hr * 2, hr * 2);
    }
    ctx.restore();
  }

  // Tool Overlay: Brush Morph Circle (Size + Hardness inner ring)
  if (
    opts.activeTool === 'brush_morph' &&
    opts.brushCursor &&
    opts.brushCursor.visible
  ) {
    const bc = opts.brushCursor;
    ctx.save();
    ctx.strokeStyle = '#2D8CEB';
    ctx.lineWidth = 1.8 / opts.scale;
    ctx.beginPath();
    ctx.arc(bc.x, bc.y, bc.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.setLineDash([4 / opts.scale, 4 / opts.scale]);
    ctx.beginPath();
    ctx.arc(
      bc.x,
      bc.y,
      Math.max(4, bc.radius * bc.hardness),
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Optional Physics Pendulum Chain overlay
  if (opts.showPhysicsOverlay) {
    for (const group of physicsGroups) {
      const runtime = physicsState[group.id];
      if (!runtime) continue;
      const isSel = opts.selectedPhysicsGroupId === group.id;

      ctx.save();
      ctx.strokeStyle = !group.enabled
        ? 'rgba(148,163,184,0.35)'
        : isSel
          ? '#F59E0B'
          : 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = (isSel ? 2.4 : 1.6) / opts.scale;

      ctx.fillStyle = isSel ? '#F59E0B' : '#38BDF8';
      ctx.beginPath();
      ctx.arc(
        runtime.anchorWorldX,
        runtime.anchorWorldY,
        5.5 / opts.scale,
        0,
        Math.PI * 2
      );
      ctx.fill();

      let px = runtime.anchorWorldX;
      let py = runtime.anchorWorldY;
      for (let i = 0; i < runtime.links.length; i++) {
        const link = runtime.links[i];
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(link.worldX, link.worldY);
        ctx.stroke();

        ctx.fillStyle = isSel ? '#FBBF24' : '#E0F2FE';
        ctx.beginPath();
        ctx.arc(link.worldX, link.worldY, 4.8 / opts.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        px = link.worldX;
        py = link.worldY;
      }

      const fontSize = Math.round(12 / opts.scale);
      ctx.font = `600 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
      const metrics = ctx.measureText(group.name);
      const padX = 6 / opts.scale;
      const padY = 3.5 / opts.scale;
      const boxW = metrics.width + padX * 2;
      const boxH = fontSize + padY * 2;

      const placeLeft = runtime.anchorWorldX < puppet.modelWidth * 0.45;
      const placeBelow = runtime.anchorWorldY > puppet.modelHeight * 0.65;
      const lx = placeLeft
        ? runtime.anchorWorldX - boxW - 12 / opts.scale
        : runtime.anchorWorldX + 12 / opts.scale;
      const ly = placeBelow
        ? runtime.anchorWorldY + 12 / opts.scale
        : runtime.anchorWorldY - boxH * 0.5 - 5 / opts.scale;

      ctx.fillStyle = 'rgba(20, 20, 20, 0.86)';
      ctx.strokeStyle = isSel
        ? 'rgba(245, 158, 11, 0.85)'
        : 'rgba(45, 140, 235, 0.5)';
      ctx.lineWidth = 1.1 / opts.scale;
      ctx.fillRect(lx, ly, boxW, boxH);
      ctx.strokeRect(lx, ly, boxW, boxH);

      ctx.fillStyle = isSel ? '#FDE68A' : '#E6E6E6';
      ctx.fillText(group.name, lx + padX, ly + fontSize + padY * 0.35);
      ctx.restore();
    }
  }

  ctx.restore();
}
