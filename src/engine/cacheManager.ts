import type { CacheStats, PreviewResolution } from '../types/puppet';

interface CacheEntry {
  key: string;
  bytes: number;
  category: 'texture' | 'physics' | 'mesh';
}

const AE_DEFAULT_CACHE_PATH =
  '%LOCALAPPDATA%\\Adobe\\After Effects\\Disk Cache\\RiokaPuppetingTools_Cache';

class RiokaCacheManager {
  private entries = new Map<string, CacheEntry>();
  private lastPurgedAt: string | null = null;
  private listeners = new Set<() => void>();

  registerTexture(key: string, width: number, height: number): void {
    const bytes = Math.max(4096, Math.round(width * height * 4));
    const prev = this.entries.get(key);
    if (prev && prev.bytes === bytes) return;
    this.entries.set(key, { key, bytes, category: 'texture' });
    this.notify();
  }

  registerPhysicsFrames(frameCount: number, groupCount: number): void {
    const bytes = Math.max(0, frameCount * groupCount * 512);
    this.entries.set('__physics_baked_cache__', {
      key: '__physics_baked_cache__',
      bytes,
      category: 'physics',
    });
    this.notify();
  }

  registerMeshBuffers(layerCount: number, resolution: PreviewResolution, customPct: number): void {
    const scaleFactor =
      resolution === 'full'
        ? 1
        : resolution === 'half'
          ? 0.25
          : resolution === 'third'
            ? 0.11
            : resolution === 'quarter'
              ? 0.0625
              : Math.pow(Math.max(10, Math.min(100, customPct)) / 100, 2);
    // Estimate active framebuffer + mesh vertex array footprint
    const frameBufferBytes = Math.round(1920 * 1080 * 4 * scaleFactor);
    const meshBytes = layerCount * 24576;
    this.entries.set('__viewport_buffers__', {
      key: '__viewport_buffers__',
      bytes: frameBufferBytes + meshBytes,
      category: 'mesh',
    });
    this.notify();
  }

  /**
   * Mirrors Adobe After Effects "Edit -> Purge -> All Memory & Disk Cache":
   * drops all cached PSD texture atlases, working mesh buffers, and baked physics cache files.
   */
  purgeAllMemoryAndDiskCache(onClearTextureCache?: () => void): CacheStats {
    this.entries.clear();
    onClearTextureCache?.();
    this.lastPurgedAt = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    this.notify();
    return this.getStats();
  }

  getStats(): CacheStats {
    let ramBytes = 0;
    let diskCacheBytes = 0;
    let cachedTextures = 0;
    let cachedPhysicsFrames = 0;

    for (const entry of this.entries.values()) {
      if (entry.category === 'texture') {
        cachedTextures += 1;
        diskCacheBytes += entry.bytes;
        ramBytes += Math.round(entry.bytes * 0.55);
      } else if (entry.category === 'physics') {
        diskCacheBytes += entry.bytes;
        ramBytes += entry.bytes;
        cachedPhysicsFrames = Math.round(entry.bytes / 2048);
      } else {
        ramBytes += entry.bytes;
      }
    }

    return {
      ramBytes,
      diskCacheBytes,
      cachedTextures,
      cachedPhysicsFrames,
      cacheFolderPath: AE_DEFAULT_CACHE_PATH,
      lastPurgedAt: this.lastPurgedAt,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

export const cacheManager = new RiokaCacheManager();

export function formatBytesToMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.05) return '0.0 MB';
  return `${mb.toFixed(1)} MB`;
}

export function getPreviewResolutionScale(
  res: PreviewResolution,
  customPercent: number
): number {
  switch (res) {
    case 'full':
      return 1;
    case 'half':
      return 0.5;
    case 'third':
      return 1 / 3;
    case 'quarter':
      return 0.25;
    case 'custom':
      return Math.max(0.15, Math.min(1, customPercent / 100));
  }
}
