import { readPsd, type Layer as AgPsdLayer } from 'ag-psd';
import type {
  ArtMeshLayer,
  DeformerNode,
  PsdManifest,
  PuppetDocument,
  RiokaPuppetEffect,
} from '../types/puppet';
import { createDefaultBasicLattice } from './morphTools';

export interface IncomingPsdLayer {
  psdLayerName: string;
  name: string;
  x: number; // center X in model space (1024x1024)
  y: number; // center Y in model space (1024x1024)
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
  textureDataUrl: string;
}

export interface PsdRenewResult {
  layers: ArtMeshLayer[];
  manifest: PsdManifest;
}

function guessPartGroup(layerName: string): ArtMeshLayer['partGroup'] {
  const n = layerName.toLowerCase();
  if (n.includes('back') && n.includes('hair')) return 'hair_back';
  if (n.includes('tail') || n.includes('ponytail') || n.includes('twin'))
    return 'hair_back';
  if (n.includes('bang') || n.includes('front') || n.includes('hair'))
    return 'hair_front';
  if (n.includes('eye') || n.includes('iris') || n.includes('brow') || n.includes('lash'))
    return 'eyes';
  if (n.includes('mouth') || n.includes('lip')) return 'mouth';
  if (n.includes('blush') || n.includes('nose') || n.includes('face') || n.includes('cheek'))
    return 'face';
  if (n.includes('head') || n.includes('ear')) return 'head';
  if (n.includes('ribbon') || n.includes('bow') || n.includes('hat') || n.includes('clip') || n.includes('acc'))
    return 'accessories';
  if (n.includes('body') || n.includes('neck') || n.includes('torso') || n.includes('arm') || n.includes('collar'))
    return 'body';
  return 'custom';
}

function guessDeformerForLayer(
  layerName: string,
  availableDeformerIds: Set<string>
): string {
  const n = layerName.toLowerCase();
  const pick = (id: string, fallback: string) =>
    availableDeformerIds.has(id) ? id : fallback;

  if (n.includes('twin') && n.includes('left')) return pick('def_hair_tail_l', 'def_head');
  if (n.includes('twin') && n.includes('right')) return pick('def_hair_tail_r', 'def_head');
  if (n.includes('ribbon')) return pick('def_ribbon', 'def_head');
  if (n.includes('bang') || (n.includes('hair') && n.includes('front')))
    return pick('def_hair_front', 'def_head');
  if (n.includes('hair') && n.includes('back'))
    return pick('def_hair_back', 'def_head');
  if (n.includes('eye') && (n.includes('left') || n.includes('_l')))
    return pick('def_eye_l', 'def_face');
  if (n.includes('eye') && (n.includes('right') || n.includes('_r')))
    return pick('def_eye_r', 'def_face');
  if (n.includes('mouth')) return pick('def_mouth', 'def_face');
  if (n.includes('brow') || n.includes('blush') || n.includes('nose') || n.includes('face'))
    return pick('def_face', 'def_head');
  if (n.includes('head') || n.includes('ear')) return pick('def_head', 'def_body');
  return pick('def_body', availableDeformerIds.values().next().value ?? 'def_root');
}

/**
 * Pure renewable PSD merger:
 * Matches incoming PSD layers by `psdLayerName` (case-insensitive trimmed).
 * - Matched layers keep their existing `id`, `parentDeformerId`, `meshCols/Rows`, `vertexOffsets`, and `pivot`
 *   while renewing artwork (`textureDataUrl`), bounding dimensions, and z-order.
 * - New layers are auto-assigned to the best matching deformer.
 * - Existing rig keyforms & physics chains referencing layer IDs remain 100% intact.
 */
export function mergeRenewedPsdLayers(
  currentDoc: PuppetDocument,
  incomingLayers: IncomingPsdLayer[],
  fileName: string,
  width: number,
  height: number,
  sourceType: PsdManifest['sourceType']
): PsdRenewResult {
  const existingByKey = new Map<string, ArtMeshLayer>();
  for (const layer of currentDoc.layers) {
    existingByKey.set(layer.psdLayerName.trim().toLowerCase(), layer);
  }

  const deformerIds = new Set(currentDoc.deformers.map((d) => d.id));
  const merged: ArtMeshLayer[] = [];
  let matchedLayers = 0;
  let addedLayers = 0;

  incomingLayers.forEach((inc, idx) => {
    const key = inc.psdLayerName.trim().toLowerCase();
    const prev = existingByKey.get(key);

    if (prev) {
      matchedLayers += 1;
      merged.push({
        ...prev,
        name: inc.name,
        zIndex: inc.zIndex ?? idx,
        x: inc.x,
        y: inc.y,
        width: Math.max(8, inc.width),
        height: Math.max(8, inc.height),
        opacity: inc.opacity,
        textureDataUrl: inc.textureDataUrl,
        psdStatus: 'matched',
      });
    } else {
      addedLayers += 1;
      const cols = 4;
      const rows = 4;
      merged.push({
        id: `layer_${key.replace(/[^a-z0-9]+/g, '_')}_${idx}`,
        psdLayerName: inc.psdLayerName,
        name: inc.name,
        partGroup: guessPartGroup(inc.psdLayerName),
        zIndex: inc.zIndex ?? idx,
        x: inc.x,
        y: inc.y,
        width: Math.max(8, inc.width),
        height: Math.max(8, inc.height),
        pivotX: 0.5,
        pivotY: 0.5,
        boneTransform: { dx: 0, dy: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        opacity: inc.opacity,
        visible: inc.visible,
        locked: false,
        parentDeformerId: guessDeformerForLayer(inc.psdLayerName, deformerIds),
        groupLayerId: null,
        meshCols: cols,
        meshRows: rows,
        vertexOffsets: Array.from({ length: (cols + 1) * (rows + 1) }, () => ({
          dx: 0,
          dy: 0,
        })),
        morphPins: [],
        basicLattice: createDefaultBasicLattice(3, 3),
        textureDataUrl: inc.textureDataUrl,
        psdStatus: 'added',
      });
    }
  });

  // Count how many existing keyform & physics bindings survived renewal
  const activeLayerIds = new Set(merged.map((l) => l.id));
  const preservedRigBindings =
    currentDoc.keyforms.filter(
      (k) => k.targetType === 'deformer' || activeLayerIds.has(k.targetId)
    ).length +
    currentDoc.physicsGroups.reduce(
      (acc, g) =>
        acc +
        g.outputs.filter(
          (o) => o.targetType === 'deformer' || activeLayerIds.has(o.targetId)
        ).length,
      0
    );

  const manifest: PsdManifest = {
    fileName,
    revision: currentDoc.psd.revision + 1,
    lastUpdated: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    width,
    height,
    sourceType,
    matchedLayers,
    addedLayers,
    preservedRigBindings,
  };

  return {
    layers: merged.sort((a, b) => a.zIndex - b.zIndex),
    manifest,
  };
}

function createCleanBaseDeformers(): DeformerNode[] {
  const zeroBase = () => ({
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    opacity: 1,
  });
  return [
    {
      id: 'def_root',
      name: 'Root Transform',
      type: 'rotation',
      parentId: null,
      pivotX: 512,
      pivotY: 512,
      width: 1024,
      height: 1024,
      baseTransform: zeroBase(),
    },
    {
      id: 'def_body',
      name: 'Body Torso',
      type: 'rotation',
      parentId: 'def_root',
      pivotX: 512,
      pivotY: 820,
      width: 640,
      height: 760,
      baseTransform: zeroBase(),
    },
    {
      id: 'def_head',
      name: 'Head Pivot',
      type: 'rotation',
      parentId: 'def_body',
      pivotX: 512,
      pivotY: 460,
      width: 480,
      height: 480,
      baseTransform: zeroBase(),
    },
  ];
}

/**
 * Pure fresh-PSD importer:
 * Loads a brand-new user PSD onto a clean rig slate so users can build their own parameters:
 * - Replaces layers with the imported PSD layers (assigned to clean zeroed base deformers).
 * - Clears all built-in demo parameters, folders, keyforms, timeline tracks, and demo physics groups.
 * - Turns automatic breathing OFF (`autoBreath: false`); users can re-enable it anytime via the Auto-Breath toggle.
 */
export function applyNewPsdImportToEffect(
  currentEffect: RiokaPuppetEffect,
  incomingLayers: IncomingPsdLayer[],
  fileName: string,
  width: number,
  height: number
): RiokaPuppetEffect {
  const cleanDeformers = createCleanBaseDeformers();
  const deformerIds = new Set(cleanDeformers.map((d) => d.id));

  const freshLayers: ArtMeshLayer[] = incomingLayers
    .map((inc, idx) => {
      const key = inc.psdLayerName.trim().toLowerCase();
      const slug = key.replace(/[^a-z0-9]+/g, '_') || 'part';
      const cols = 4;
      const rows = 4;
      return {
        id: `layer_${slug}_${idx}`,
        psdLayerName: inc.psdLayerName,
        name: inc.name,
        partGroup: guessPartGroup(inc.psdLayerName),
        zIndex: inc.zIndex ?? idx,
        x: inc.x,
        y: inc.y,
        width: Math.max(8, inc.width),
        height: Math.max(8, inc.height),
        pivotX: 0.5,
        pivotY: 0.5,
        boneTransform: { dx: 0, dy: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        opacity: inc.opacity,
        visible: inc.visible,
        locked: false,
        parentDeformerId: guessDeformerForLayer(inc.psdLayerName, deformerIds),
        parentLayerId: null,
        groupLayerId: null,
        meshCols: cols,
        meshRows: rows,
        vertexOffsets: Array.from({ length: (cols + 1) * (rows + 1) }, () => ({
          dx: 0,
          dy: 0,
        })),
        morphPins: [],
        basicLattice: createDefaultBasicLattice(3, 3),
        textureDataUrl: inc.textureDataUrl,
        psdStatus: 'added' as const,
      };
    })
    .sort((a, b) => a.zIndex - b.zIndex);

  const cleanName = fileName.replace(/\.psd$/i, '').trim() || 'Imported Puppet';

  const manifest: PsdManifest = {
    fileName,
    revision: 1,
    lastUpdated: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    width,
    height,
    sourceType: 'user-psd',
    matchedLayers: 0,
    addedLayers: freshLayers.length,
    preservedRigBindings: 0,
  };

  return {
    ...currentEffect,
    autoBreath: false,
    tracks: {},
    puppet: {
      ...currentEffect.puppet,
      name: cleanName,
      psd: manifest,
      deformers: cleanDeformers,
      layers: freshLayers,
      parameters: [],
      parameterFolders: [],
      keyforms: [],
      physicsGroups: [],
    },
  };
}

/**
 * Parses a real Photoshop .psd file buffer in the browser using ag-psd,
 * normalizing coordinates into the 1024x1024 puppet model space.
 */
export async function parseRealPsdArrayBuffer(
  buffer: ArrayBuffer,
  fileName: string
): Promise<{
  layers: IncomingPsdLayer[];
  width: number;
  height: number;
  fileName: string;
}> {
  const psd = readPsd(buffer, {
    skipCompositeImageData: true,
    skipThumbnail: true,
  });

  const docW = Math.max(1, psd.width || 1024);
  const docH = Math.max(1, psd.height || 1024);

  // Fit PSD cleanly inside 1024x1024 model coordinate space
  const fitScale = Math.min(860 / docW, 900 / docH);
  const offsetX = (1024 - docW * fitScale) * 0.5;
  const offsetY = (1024 - docH * fitScale) * 0.5;

  const collected: IncomingPsdLayer[] = [];
  let zCounter = 0;

  const walk = (nodes: AgPsdLayer[] | undefined, prefix: string) => {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        walk(node.children, prefix ? `${prefix}/${node.name ?? 'Group'}` : node.name ?? '');
        continue;
      }
      if (!node.canvas) continue;
      const w = node.canvas.width;
      const h = node.canvas.height;
      if (w <= 0 || h <= 0) continue;

      const left = node.left ?? 0;
      const top = node.top ?? 0;
      const centerX = offsetX + (left + w * 0.5) * fitScale;
      const centerY = offsetY + (top + h * 0.5) * fitScale;
      const dataUrl = (node.canvas as HTMLCanvasElement).toDataURL('image/png');
      const rawName = (node.name || `Layer_${zCounter + 1}`).trim();

      collected.push({
        psdLayerName: rawName,
        name: rawName,
        x: centerX,
        y: centerY,
        width: w * fitScale,
        height: h * fitScale,
        opacity: node.opacity !== undefined ? node.opacity : 1,
        visible: !node.hidden,
        zIndex: zCounter++,
        textureDataUrl: dataUrl,
      });
    }
  };

  walk(psd.children, '');

  if (collected.length === 0) {
    throw new Error(
      'No rasterized layers were found in this PSD. Export with Maximize Compatibility enabled in Photoshop or Clip Studio Paint.'
    );
  }

  return {
    layers: collected,
    width: docW,
    height: docH,
    fileName,
  };
}

/**
 * Generates crisp, multi-layer vector-painted SVG Data URLs for the built-in Rioka 2D anime character PSD.
 * Works identically in both browser and Node.js unit tests (pure string SVG -> base64/URI data URLs).
 */
export function buildDemoPsdLayers(
  variant: 'classic' | 'festival'
): IncomingPsdLayer[] {
  const isFestival = variant === 'festival';

  const palette = isFestival
    ? {
        hairBase: '#2E2A4A',
        hairMid: '#433D6B',
        hairHighlight: '#7E74B8',
        hairTip: '#D96B98',
        hairStroke: '#1B182E',
        outfitMain: '#FFF5F7',
        outfitAccent: '#E11D48',
        outfitTrim: '#F59E0B',
        ribbonMain: '#F43F5E',
        ribbonShadow: '#9F1239',
        eyeTop: '#4C1D95',
        eyeMid: '#EC4899',
        eyeGlow: '#FDE68A',
      }
    : {
        hairBase: '#273145',
        hairMid: '#3A4A68',
        hairHighlight: '#7AA2D6',
        hairTip: '#5373A8',
        hairStroke: '#141B29',
        outfitMain: '#F3F6FA',
        outfitAccent: '#2563EB',
        outfitTrim: '#38BDF8',
        ribbonMain: '#E11D48',
        ribbonShadow: '#9F1239',
        eyeTop: '#1E3A8A',
        eyeMid: '#3B82F6',
        eyeGlow: '#BAE6FD',
      };

  const svgUrl = (w: number, h: number, body: string) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };

  const layers: IncomingPsdLayer[] = [
    // 0: Hair Back Silhouette
    {
      psdLayerName: 'Hair_Back',
      name: 'Hair Back',
      x: 512,
      y: 440,
      width: 420,
      height: 460,
      opacity: 1,
      visible: true,
      zIndex: 0,
      textureDataUrl: svgUrl(
        420,
        460,
        `<defs>
          <linearGradient id="hb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${palette.hairBase}"/>
            <stop offset="72%" stop-color="${palette.hairMid}"/>
            <stop offset="100%" stop-color="${palette.hairTip}"/>
          </linearGradient>
        </defs>
        <path d="M90,115 C110,30 310,30 330,115 C365,205 375,335 340,425 C305,400 280,435 210,435 C140,435 115,400 80,425 C45,335 55,205 90,115 Z" fill="url(#hb)" stroke="${palette.hairStroke}" stroke-width="5"/>
        <path d="M120,250 C145,320 150,385 135,418 M300,250 C275,320 270,385 285,418" stroke="${palette.hairStroke}" stroke-width="3" fill="none" opacity="0.45"/>`
      ),
    },
    // 1: Twin Tail Left
    {
      psdLayerName: 'Hair_TwinTail_L',
      name: 'Twin-Tail Left',
      x: 318,
      y: 525,
      width: 210,
      height: 440,
      opacity: 1,
      visible: true,
      zIndex: 1,
      textureDataUrl: svgUrl(
        210,
        440,
        `<defs>
          <linearGradient id="tl" x1="0.7" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stop-color="${palette.hairBase}"/>
            <stop offset="65%" stop-color="${palette.hairMid}"/>
            <stop offset="100%" stop-color="${palette.hairTip}"/>
          </linearGradient>
        </defs>
        <path d="M155,34 C115,52 62,132 46,238 C32,324 54,394 94,424 C84,368 94,312 114,274 C116,326 124,376 144,408 C154,330 164,252 170,170 C176,108 176,56 155,34 Z" fill="url(#tl)" stroke="${palette.hairStroke}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M134,88 C94,158 76,244 82,334" stroke="${palette.hairHighlight}" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.55"/>`
      ),
    },
    // 2: Twin Tail Right
    {
      psdLayerName: 'Hair_TwinTail_R',
      name: 'Twin-Tail Right',
      x: 706,
      y: 525,
      width: 210,
      height: 440,
      opacity: 1,
      visible: true,
      zIndex: 2,
      textureDataUrl: svgUrl(
        210,
        440,
        `<defs>
          <linearGradient id="tr" x1="0.3" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stop-color="${palette.hairBase}"/>
            <stop offset="65%" stop-color="${palette.hairMid}"/>
            <stop offset="100%" stop-color="${palette.hairTip}"/>
          </linearGradient>
        </defs>
        <path d="M55,34 C95,52 148,132 164,238 C178,324 156,394 116,424 C126,368 116,312 96,274 C94,326 86,376 66,408 C56,330 46,252 40,170 C34,108 34,56 55,34 Z" fill="url(#tr)" stroke="${palette.hairStroke}" stroke-width="5" stroke-linejoin="round"/>
        <path d="M76,88 C116,158 134,244 128,334" stroke="${palette.hairHighlight}" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.55"/>`
      ),
    },
    // 3: Body Torso & Shoulders (refined graceful neck & bust framing)
    {
      psdLayerName: 'Body_Torso',
      name: 'Body & Outfit',
      x: 512,
      y: 728,
      width: 480,
      height: 460,
      opacity: 1,
      visible: true,
      zIndex: 3,
      textureDataUrl: svgUrl(
        480,
        460,
        `<defs>
          <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#EAC2AE"/>
            <stop offset="32%" stop-color="#FADACC"/>
            <stop offset="100%" stop-color="#FDE9DF"/>
          </linearGradient>
          <linearGradient id="coat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${palette.outfitMain}"/>
            <stop offset="100%" stop-color="#D7DFEC"/>
          </linearGradient>
        </defs>
        <!-- Graceful Neck -->
        <path d="M210,10 L270,10 L278,96 L202,96 Z" fill="url(#skin)" stroke="#7C5748" stroke-width="4"/>
        <ellipse cx="240" cy="36" rx="34" ry="18" fill="#DFAA93" opacity="0.6"/>
        <!-- Shoulders & Jacket -->
        <path d="M58,454 C68,300 100,152 164,96 C190,78 290,78 316,96 C380,152 412,300 422,454 Z" fill="url(#coat)" stroke="#232B3A" stroke-width="5" stroke-linejoin="round"/>
        <!-- Sailor / Studio Collar -->
        <path d="M158,94 L240,218 L322,94 L356,132 L294,228 L240,242 L186,228 L124,132 Z" fill="${palette.outfitAccent}" stroke="#192130" stroke-width="4.5" stroke-linejoin="round"/>
        <path d="M146,120 L192,210 L240,224 L288,210 L334,120" fill="none" stroke="${palette.outfitTrim}" stroke-width="4.5" stroke-linecap="round"/>
        <!-- Inner Shirt V -->
        <path d="M190,88 L240,202 L290,88 Z" fill="#FFFFFF" stroke="#232B3A" stroke-width="3.5"/>
        <!-- Shoulder sleeve crease highlights -->
        <path d="M120,210 C110,275 104,355 102,440 M360,210 C370,275 376,355 378,440" fill="none" stroke="#94A3B8" stroke-width="3.5" opacity="0.5"/>
        ${
          isFestival
            ? `<circle cx="164" cy="316" r="15" fill="${palette.outfitTrim}" opacity="0.78"/>
               <circle cx="316" cy="316" r="15" fill="${palette.outfitTrim}" opacity="0.78"/>
               <path d="M108,284 L372,284" stroke="${palette.outfitAccent}" stroke-width="10" opacity="0.35"/>`
            : `<line x1="240" y1="242" x2="240" y2="452" stroke="#94A3B8" stroke-width="3"/>
               <circle cx="222" cy="308" r="5.5" fill="#475569"/>
               <circle cx="258" cy="308" r="5.5" fill="#475569"/>
               <circle cx="222" cy="368" r="5.5" fill="#475569"/>
               <circle cx="258" cy="368" r="5.5" fill="#475569"/>`
        }`
      ),
    },
    // 4: Chest Ribbon (Physics driven!)
    {
      psdLayerName: 'Body_Ribbon',
      name: 'Chest Ribbon',
      x: 512,
      y: 724,
      width: 170,
      height: 180,
      opacity: 1,
      visible: true,
      zIndex: 4,
      textureDataUrl: svgUrl(
        170,
        180,
        `<path d="M85,48 L48,152 L74,142 L85,72 L96,142 L122,152 Z" fill="${palette.ribbonShadow}" stroke="#3B0B1B" stroke-width="4" stroke-linejoin="round"/>
        <path d="M85,46 C54,18 18,22 20,56 C22,82 56,74 85,54 C114,74 148,82 150,56 C152,22 116,18 85,46 Z" fill="${palette.ribbonMain}" stroke="#3B0B1B" stroke-width="4" stroke-linejoin="round"/>
        <circle cx="85" cy="50" r="12" fill="${palette.outfitTrim}" stroke="#3B0B1B" stroke-width="3.5"/>`
      ),
    },
    // 5: Head Base + Ears
    {
      psdLayerName: 'Head_Base',
      name: 'Head & Ears',
      x: 512,
      y: 416,
      width: 340,
      height: 360,
      opacity: 1,
      visible: true,
      zIndex: 5,
      textureDataUrl: svgUrl(
        340,
        360,
        `<defs>
          <radialGradient id="faceGrad" cx="50%" cy="46%" r="54%">
            <stop offset="0%" stop-color="#FFF2EA"/>
            <stop offset="78%" stop-color="#FCE1D2"/>
            <stop offset="100%" stop-color="#F2C8B5"/>
          </radialGradient>
        </defs>
        <!-- Ears -->
        <ellipse cx="48" cy="212" rx="22" ry="34" fill="#FAD7C5" stroke="#7C5748" stroke-width="4"/>
        <ellipse cx="292" cy="212" rx="22" ry="34" fill="#FAD7C5" stroke="#7C5748" stroke-width="4"/>
        <!-- Face Contour -->
        <path d="M56,162 C56,72 104,34 170,34 C236,34 284,72 284,162 C284,232 264,284 218,314 C194,330 182,336 170,336 C158,336 146,330 122,314 C76,284 56,232 56,162 Z" fill="url(#faceGrad)" stroke="#7C5748" stroke-width="4.5"/>`
      ),
    },
    // 6: Face Blush & Nose
    {
      psdLayerName: 'Face_Blush_Nose',
      name: 'Blush & Nose',
      x: 512,
      y: 454,
      width: 240,
      height: 110,
      opacity: 0.92,
      visible: true,
      zIndex: 6,
      textureDataUrl: svgUrl(
        240,
        110,
        `<defs>
          <radialGradient id="blush">
            <stop offset="0%" stop-color="#FB7185" stop-opacity="0.58"/>
            <stop offset="100%" stop-color="#FB7185" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <ellipse cx="48" cy="64" rx="34" ry="18" fill="url(#blush)"/>
        <ellipse cx="192" cy="64" rx="34" ry="18" fill="url(#blush)"/>
        <path d="M35,62 L44,56 M48,66 L57,60 M183,66 L192,60 M196,62 L205,56" stroke="#F43F5E" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
        <path d="M119,44 L123,54 L117,57" fill="none" stroke="#9A6B5A" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
      ),
    },
    // 7: Left Eye White & Lashes
    {
      psdLayerName: 'Eye_Left',
      name: 'Eye Left',
      x: 450,
      y: 422,
      width: 96,
      height: 92,
      opacity: 1,
      visible: true,
      zIndex: 7,
      textureDataUrl: svgUrl(
        96,
        92,
        `<defs>
          <linearGradient id="irisL" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${palette.eyeTop}"/>
            <stop offset="58%" stop-color="${palette.eyeMid}"/>
            <stop offset="100%" stop-color="${palette.eyeGlow}"/>
          </linearGradient>
        </defs>
        <path d="M12,48 C18,22 76,20 84,48 C78,74 22,76 12,48 Z" fill="#FFFFFF"/>
        <ellipse cx="50" cy="49" rx="22" ry="25" fill="url(#irisL)" stroke="#151D33" stroke-width="2.5"/>
        <ellipse cx="50" cy="49" rx="10" ry="12" fill="#0F172A"/>
        <circle cx="40" cy="39" r="6.5" fill="#FFFFFF"/>
        <circle cx="60" cy="59" r="3.4" fill="#FFFFFF" opacity="0.9"/>
        <!-- Upper Eyelash -->
        <path d="M8,46 C18,16 74,14 88,42 C74,26 24,26 8,46 Z" fill="#1E1B2E"/>
        <path d="M14,34 L6,26" stroke="#1E1B2E" stroke-width="4" stroke-linecap="round"/>
        <path d="M24,68 C42,74 64,73 78,65" fill="none" stroke="#6E4F46" stroke-width="2.5" stroke-linecap="round"/>`
      ),
    },
    // 8: Right Eye White & Lashes
    {
      psdLayerName: 'Eye_Right',
      name: 'Eye Right',
      x: 574,
      y: 422,
      width: 96,
      height: 92,
      opacity: 1,
      visible: true,
      zIndex: 8,
      textureDataUrl: svgUrl(
        96,
        92,
        `<defs>
          <linearGradient id="irisR" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${palette.eyeTop}"/>
            <stop offset="58%" stop-color="${palette.eyeMid}"/>
            <stop offset="100%" stop-color="${palette.eyeGlow}"/>
          </linearGradient>
        </defs>
        <path d="M12,48 C18,22 76,20 84,48 C78,74 22,76 12,48 Z" fill="#FFFFFF"/>
        <ellipse cx="46" cy="49" rx="22" ry="25" fill="url(#irisR)" stroke="#151D33" stroke-width="2.5"/>
        <ellipse cx="46" cy="49" rx="10" ry="12" fill="#0F172A"/>
        <circle cx="36" cy="39" r="6.5" fill="#FFFFFF"/>
        <circle cx="56" cy="59" r="3.4" fill="#FFFFFF" opacity="0.9"/>
        <!-- Upper Eyelash -->
        <path d="M88,46 C78,16 22,14 8,42 C22,26 72,26 88,46 Z" fill="#1E1B2E"/>
        <path d="M82,34 L90,26" stroke="#1E1B2E" stroke-width="4" stroke-linecap="round"/>
        <path d="M18,65 C32,73 54,74 72,68" fill="none" stroke="#6E4F46" stroke-width="2.5" stroke-linecap="round"/>`
      ),
    },
    // 9: Eyebrows
    {
      psdLayerName: 'Face_Eyebrows',
      name: 'Eyebrows',
      x: 512,
      y: 368,
      width: 224,
      height: 44,
      opacity: 1,
      visible: true,
      zIndex: 9,
      textureDataUrl: svgUrl(
        224,
        44,
        `<path d="M22,26 C40,14 68,14 86,24" fill="none" stroke="${palette.hairStroke}" stroke-width="5.5" stroke-linecap="round"/>
        <path d="M138,24 C156,14 184,14 202,26" fill="none" stroke="${palette.hairStroke}" stroke-width="5.5" stroke-linecap="round"/>`
      ),
    },
    // 10: Mouth
    {
      psdLayerName: 'Face_Mouth',
      name: 'Mouth',
      x: 512,
      y: 506,
      width: 88,
      height: 62,
      opacity: 1,
      visible: true,
      zIndex: 10,
      textureDataUrl: svgUrl(
        88,
        62,
        `<path d="M18,22 C32,30 56,30 70,22 C66,46 56,52 44,52 C32,52 22,46 18,22 Z" fill="#B94B5E" stroke="#692635" stroke-width="3.2" stroke-linejoin="round"/>
        <path d="M26,42 C36,36 52,36 62,42 C56,50 32,50 26,42 Z" fill="#F48A9D"/>
        <path d="M22,24 C34,29 54,29 66,24" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>`
      ),
    },
    // 11: Hair Side Locks Left/Right
    {
      psdLayerName: 'Hair_SideLocks',
      name: 'Hair Side Locks',
      x: 512,
      y: 448,
      width: 370,
      height: 350,
      opacity: 1,
      visible: true,
      zIndex: 11,
      textureDataUrl: svgUrl(
        370,
        350,
        `<defs>
          <linearGradient id="sl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${palette.hairBase}"/>
            <stop offset="100%" stop-color="${palette.hairTip}"/>
          </linearGradient>
        </defs>
        <path d="M74,36 C44,104 38,222 66,326 C86,294 94,232 94,162 C98,108 98,64 74,36 Z" fill="url(#sl)" stroke="${palette.hairStroke}" stroke-width="4.5" stroke-linejoin="round"/>
        <path d="M296,36 C326,104 332,222 304,326 C284,294 276,232 276,162 C272,108 272,64 296,36 Z" fill="url(#sl)" stroke="${palette.hairStroke}" stroke-width="4.5" stroke-linejoin="round"/>`
      ),
    },
    // 12: Hair Front Bangs
    {
      psdLayerName: 'Hair_Front_Bangs',
      name: 'Hair Front Bangs',
      x: 512,
      y: 304,
      width: 360,
      height: 250,
      opacity: 1,
      visible: true,
      zIndex: 12,
      textureDataUrl: svgUrl(
        360,
        250,
        `<defs>
          <linearGradient id="hf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${palette.hairBase}"/>
            <stop offset="62%" stop-color="${palette.hairMid}"/>
            <stop offset="100%" stop-color="${palette.hairTip}"/>
          </linearGradient>
        </defs>
        <path d="M36,194 C36,84 96,22 180,22 C264,22 324,84 324,194 C308,162 292,138 278,128 C282,164 274,198 256,222 C248,186 238,154 224,132 C220,176 206,210 184,228 C176,186 168,150 156,130 C142,166 130,198 112,218 C104,182 100,152 92,132 C76,154 56,176 36,194 Z" fill="url(#hf)" stroke="${palette.hairStroke}" stroke-width="5" stroke-linejoin="round"/>
        <!-- Glossy Anime Hair Halo -->
        <path d="M88,118 C118,96 154,96 172,110 M194,108 C222,94 252,98 274,118" fill="none" stroke="${palette.hairHighlight}" stroke-width="8" stroke-linecap="round" opacity="0.65"/>`
      ),
    },
    // 13: Hair Ribbon & Clip Accessory
    {
      psdLayerName: 'Hair_Ribbon_Top',
      name: isFestival ? 'Sakura Hair Crest' : 'Hair Ribbon Clips',
      x: 512,
      y: 254,
      width: 340,
      height: 120,
      opacity: 1,
      visible: true,
      zIndex: 13,
      textureDataUrl: svgUrl(
        340,
        120,
        isFestival
          ? `<g>
              <path d="M58,76 C34,54 20,76 42,96 C26,112 52,118 68,98 C86,116 106,102 88,84 C106,66 84,48 68,68 Z" fill="${palette.ribbonMain}" stroke="#4C0519" stroke-width="3.5"/>
              <circle cx="65" cy="82" r="9" fill="#FDE047" stroke="#4C0519" stroke-width="2.5"/>
              <path d="M282,76 C306,54 320,76 298,96 C314,112 288,118 272,98 C254,116 234,102 252,84 C234,66 256,48 272,68 Z" fill="${palette.ribbonMain}" stroke="#4C0519" stroke-width="3.5"/>
              <circle cx="275" cy="82" r="9" fill="#FDE047" stroke="#4C0519" stroke-width="2.5"/>
              <path d="M168,26 C180,8 206,12 198,34 C192,48 176,46 168,26 Z" fill="${palette.hairMid}" stroke="${palette.hairStroke}" stroke-width="3.5"/>
            </g>`
          : `<g>
              <path d="M58,82 L30,54 L26,90 L58,86 Z M58,82 L86,58 L84,96 L58,86 Z" fill="${palette.ribbonMain}" stroke="#4C0519" stroke-width="3.5" stroke-linejoin="round"/>
              <circle cx="58" cy="82" r="8" fill="${palette.outfitTrim}" stroke="#4C0519" stroke-width="3"/>
              <path d="M282,82 L310,54 L314,90 L282,86 Z M282,82 L254,58 L256,96 L282,86 Z" fill="${palette.ribbonMain}" stroke="#4C0519" stroke-width="3.5" stroke-linejoin="round"/>
              <circle cx="282" cy="82" r="8" fill="${palette.outfitTrim}" stroke="#4C0519" stroke-width="3"/>
              <!-- Ahoge strand -->
              <path d="M174,38 C166,8 204,4 214,26 C198,20 186,28 184,42 Z" fill="${palette.hairBase}" stroke="${palette.hairStroke}" stroke-width="3.5"/>
            </g>`
      ),
    },
  ];

  return layers;
}
