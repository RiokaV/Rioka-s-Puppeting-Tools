import React, { useEffect, useState } from 'react';
import { Film, X } from 'lucide-react';
import type { GalleryBackgroundConfig } from '../types/puppet';
import {
  formatVideoStartTime,
  parseVideoStartTime,
} from '../engine/morphTools';

interface VideoBgPopupProps {
  config: GalleryBackgroundConfig;
  fps: number;
  onUpdate: (patch: Partial<GalleryBackgroundConfig>) => void;
  onClose: () => void;
}

/**
 * Floating popup tab displayed when a user loads a video via Change Background -> From Gallery.
 * Supports: Sync with Animation, Start Time (Ctrl+Click toggles Timestamp <-> Frame),
 * Quality, and "Show on Actual Solid Layer".
 */
export function VideoBgPopup({
  config,
  fps,
  onUpdate,
  onClose,
}: VideoBgPopupProps) {
  const [startInput, setStartInput] = useState(() =>
    formatVideoStartTime(config.startTimeSec, fps, config.startTimeDisplayMode)
  );

  useEffect(() => {
    setStartInput(
      formatVideoStartTime(config.startTimeSec, fps, config.startTimeDisplayMode)
    );
  }, [config.startTimeSec, fps, config.startTimeDisplayMode]);

  const handleToggleDisplayMode = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const nextMode =
        config.startTimeDisplayMode === 'timecode' ? 'frame' : 'timecode';
      onUpdate({ startTimeDisplayMode: nextMode });
    }
  };

  const commitStartTime = () => {
    const parsedSec = parseVideoStartTime(
      startInput,
      fps,
      config.startTimeDisplayMode
    );
    onUpdate({ startTimeSec: parsedSec });
  };

  return (
    <div
      data-testid="video-bg-settings-popup"
      className="fixed right-3 top-[86px] z-[86] w-[264px] rounded-[6px] bg-[#242424] border border-[#4A4A4A] shadow-2xl overflow-hidden text-[11px]"
    >
      <div className="h-7 px-2.5 bg-[#202020] border-b border-[#3A3A3A] flex items-center justify-between">
        <span className="font-semibold text-[#F0F0F0] flex items-center gap-1.5 truncate">
          <Film className="w-3.5 h-3.5 text-[#2D8CEB] shrink-0" />
          Video Background
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Video Background settings"
          className="text-[#9A9A9A] hover:text-white"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-2.5 space-y-2.5">
        <div
          className="text-[10px] font-mono text-[#A8A8A8] truncate"
          title={config.fileName}
        >
          {config.fileName}
        </div>

        {/* Sync with Animation */}
        <label className="flex items-center justify-between gap-2 cursor-pointer text-[#E6E6E6]">
          <span>Sync with Animation</span>
          <input
            type="checkbox"
            checked={config.syncWithAnimation}
            onChange={(e) => onUpdate({ syncWithAnimation: e.target.checked })}
            className="accent-[#2D8CEB]"
          />
        </label>

        {/* Start Time (Timestamp by default; Ctrl+Click toggles Timestamp <-> Frame) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="video-bg-start-time"
              onClick={handleToggleDisplayMode}
              title="Ctrl + Click to toggle Timestamp / Frame"
              className="text-[#CCCCCC] cursor-pointer select-none"
            >
              Start Time{' '}
              <span className="text-[9px] text-[#38BDF8] font-mono">
                ({config.startTimeDisplayMode === 'timecode' ? 'Time' : 'Frame'})
              </span>
            </label>
            <span className="text-[9px] text-[#8E8E8E]">Ctrl+Click unit</span>
          </div>
          <input
            id="video-bg-start-time"
            data-testid="video-bg-start-time-input"
            type="text"
            value={startInput}
            onClick={handleToggleDisplayMode}
            onChange={(e) => setStartInput(e.target.value)}
            onBlur={commitStartTime}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitStartTime();
                e.currentTarget.blur();
              }
            }}
            className="w-full px-2 py-1 rounded bg-[#141414] border border-[#424242] font-mono tabular-nums text-[#F0F0F0]"
          />
        </div>

        {/* Quality */}
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="video-bg-quality" className="text-[#CCCCCC]">
            Quality
          </label>
          <select
            id="video-bg-quality"
            value={config.quality}
            onChange={(e) =>
              onUpdate({
                quality: e.target.value as GalleryBackgroundConfig['quality'],
              })
            }
            className="px-2 py-1 rounded bg-[#181818] border border-[#424242] text-[#F0F0F0] text-[11px]"
          >
            <option value="full">Full (100%)</option>
            <option value="half">Half (50%)</option>
            <option value="third">Third (33%)</option>
            <option value="quarter">Quarter (25%)</option>
          </select>
        </div>

        {/* Show on Actual Solid Layer */}
        <label className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#363636] cursor-pointer text-[#E6E6E6]">
          <span>Show on actual solid layer</span>
          <input
            type="checkbox"
            checked={config.showOnSolidLayer}
            onChange={(e) => onUpdate({ showOnSolidLayer: e.target.checked })}
            className="accent-[#2D8CEB]"
          />
        </label>
      </div>
    </div>
  );
}
