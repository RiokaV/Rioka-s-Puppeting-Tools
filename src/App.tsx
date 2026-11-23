import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CompositionState,
  PuppetDocument,
  RiokaPuppetEffect,
  WorkspaceView,
} from './types/puppet';
import {
  createDefaultPuppetDocument,
  createDefaultPuppetEffect,
  createInitialComposition,
} from './state/defaultProject';
import {
  applyNewPsdImportToEffect,
  buildDemoPsdLayers,
  mergeRenewedPsdLayers,
  parseRealPsdArrayBuffer,
} from './engine/psdPipeline';
import {
  buildApplyKeyframesJsx,
  buildProjectJsonString,
  downloadAePluginZip,
  downloadApplyKeyframesJsx,
} from './engine/aeSdkGenerator';
import {
  buildAppliedParamsTxt,
  renderAnimatedSequenceToRpf,
  renderPuppetEffectToRpf,
} from './engine/rpfCodec';
import {
  applySavedStudioStateToComposition,
  serializeStudioStateForInstance,
} from './engine/studioStateSync';
import { cacheManager } from './engine/cacheManager';
import { clearTextureBitmapCache } from './engine/canvasRenderer';
import { TopBar } from './components/TopBar';
import { PluginWindowView } from './components/PluginWindowView';
import { AeSdkView } from './components/AeSdkView';

export default function App() {
  // Directly open into the Rioka Puppeting Tools floating-panel window
  const [activeView, setActiveView] = useState<WorkspaceView>('plugin_window');
  const [composition, setComposition] = useState<CompositionState>(() =>
    createInitialComposition()
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Snapshot for Cancel rollback within Rioka Puppeting Tools
  const sessionSnapshotRef = useRef<CompositionState | null>(null);
  if (sessionSnapshotRef.current === null) {
    sessionSnapshotRef.current = structuredClone(composition);
  }

  const flashStatus = useCallback((msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => {
      setStatusMessage((prev) => (prev === msg ? null : prev));
    }, 5000);
  }, []);

  // On mount, if opened from After Effects on an existing Solid Layer (or standalone host),
  // restore that Solid Layer's previously applied animation keyframes & rig edits.
  // Brand-new Solid Layers return { found: false } and stay completely clean with 0 keyframes.
  useEffect(() => {
    let cancelled = false;
    let heartbeatTimer: number | null = null;
    let handleUnload: (() => void) | null = null;

    (async () => {
      try {
        const infoRes = await fetch('/api/standalone-info', { method: 'GET' });
        const infoCt = infoRes.headers.get('content-type') ?? '';
        if (!infoRes.ok || !infoCt.includes('application/json')) return;
        const info = (await infoRes.json()) as {
          standalone?: boolean;
          instanceId?: string;
        };
        if (!info.standalone || cancelled) return;

        // Keep the isolated offline RiokaStudio.exe host alive strictly via loopback heartbeat
        // and notify it immediately when the Studio window is closed via the X button.
        void fetch('/api/studio-heartbeat', { method: 'POST' }).catch(() => {});
        heartbeatTimer = window.setInterval(() => {
          void fetch('/api/studio-heartbeat', { method: 'POST' }).catch(() => {});
        }, 1500);
        handleUnload = () => {
          try {
            if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
              navigator.sendBeacon('/api/studio-unload', '');
            }
          } catch {
            // ignore unload beacon error
          }
        };
        window.addEventListener('pagehide', handleUnload);
        window.addEventListener('beforeunload', handleUnload);

        const stateRes = await fetch('/api/load-studio-state', {
          method: 'GET',
        });
        const stateCt = stateRes.headers.get('content-type') ?? '';
        if (!stateRes.ok || !stateCt.includes('application/json') || cancelled) {
          return;
        }
        const savedJson = await stateRes.text();
        if (cancelled) return;

        setComposition((prev) => {
          const result = applySavedStudioStateToComposition(prev, savedJson);
          if (!result.restored) return prev;
          sessionSnapshotRef.current = structuredClone(result.composition);
          if (result.keyframeCount > 0) {
            flashStatus(
              `Restored saved animation (${result.keyframeCount} keyframe${result.keyframeCount === 1 ? '' : 's'}) for this Solid Layer.`
            );
          }
          return result.composition;
        });
      } catch {
        // Running in standard web preview without local standalone host — start clean
      }
    })();
    return () => {
      cancelled = true;
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
      }
      if (handleUnload) {
        window.removeEventListener('pagehide', handleUnload);
        window.removeEventListener('beforeunload', handleUnload);
      }
    };
  }, [flashStatus]);

  const activePuppetLayer =
    composition.layers.find(
      (l) => l.id === composition.selectedLayerId && l.effect !== null
    ) ?? composition.layers.find((l) => l.effect !== null);

  const activeEffect = activePuppetLayer?.effect ?? null;

  const updateActiveEffect = useCallback(
    (updater: (eff: RiokaPuppetEffect) => RiokaPuppetEffect) => {
      setComposition((prev) => {
        const targetId =
          prev.layers.find(
            (l) => l.id === prev.selectedLayerId && l.effect !== null
          )?.id ?? prev.layers.find((l) => l.effect !== null)?.id;
        if (!targetId) return prev;
        return {
          ...prev,
          layers: prev.layers.map((layer) =>
            layer.id === targetId && layer.effect
              ? { ...layer, effect: updater(layer.effect) }
              : layer
          ),
        };
      });
    },
    []
  );

  const updateActivePuppet = useCallback(
    (updater: (prev: PuppetDocument) => PuppetDocument) => {
      updateActiveEffect((eff) => ({
        ...eff,
        puppet: updater(eff.puppet),
      }));
    },
    [updateActiveEffect]
  );

  const syncWithStandaloneOfflineHost = useCallback(
    async (
      compSnapshot: CompositionState,
      eff: RiokaPuppetEffect | null,
      options?: { closeIfAeModal?: boolean }
    ): Promise<{ synced: boolean; aeModal: boolean; frameCount: number }> => {
      if (!eff) return { synced: false, aeModal: false, frameCount: 0 };
      try {
        const infoRes = await fetch('/api/standalone-info', { method: 'GET' });
        const contentType = infoRes.headers.get('content-type') ?? '';
        if (!infoRes.ok || !contentType.includes('application/json')) {
          return { synced: false, aeModal: false, frameCount: 0 };
        }
        const info = (await infoRes.json()) as {
          standalone?: boolean;
          aeModal?: boolean;
        };
        if (!info.standalone) {
          return { synced: false, aeModal: false, frameCount: 0 };
        }

        // 0. Persist per-Solid-Layer Studio state (keyframes, rig edits, settings) immediately
        const studioStateJson = serializeStudioStateForInstance(
          compSnapshot,
          eff
        );
        const stateRes = await fetch('/api/save-studio-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: studioStateJson,
        });

        // 1. Render current pose as transparent RGBA .rpf for immediate AE Solid Layer compositing
        const liveRpf = renderPuppetEffectToRpf(compSnapshot, eff, {
          maxEdge: 1280,
        });

        // 2. Render animated keyframe sequence (if any timeline tracks have keyframes)
        const animFrames = renderAnimatedSequenceToRpf(compSnapshot, eff);

        await fetch('/api/clear-anim-frames', { method: 'POST' });

        if (liveRpf) {
          await fetch('/api/apply-frame-rgba', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: liveRpf.buffer.slice(
              liveRpf.byteOffset,
              liveRpf.byteOffset + liveRpf.byteLength
            ) as ArrayBuffer,
          });
        }

        for (const af of animFrames) {
          await fetch(`/api/apply-anim-frame?index=${af.frameIndex}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: af.rpf.buffer.slice(
              af.rpf.byteOffset,
              af.rpf.byteOffset + af.rpf.byteLength
            ) as ArrayBuffer,
          });
        }

        const paramsTxt = buildAppliedParamsTxt(
          compSnapshot,
          eff,
          animFrames.length
        );
        const projectJson = buildProjectJsonString(compSnapshot, eff.puppet);
        const keyframesJsx = buildApplyKeyframesJsx(compSnapshot, eff);

        const [paramsRes, rigRes, jsxRes] = await Promise.all([
          fetch('/api/apply-params-txt', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: paramsTxt,
          }),
          fetch('/api/apply-rig-json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: projectJson,
          }),
          fetch('/api/apply-keyframes-jsx', {
            method: 'POST',
            headers: { 'Content-Type': 'text/javascript' },
            body: keyframesJsx,
          }),
        ]);

        const ok = paramsRes.ok && rigRes.ok && jsxRes.ok && stateRes.ok;
        const aeModal = Boolean(info.aeModal);

        // When opened from After Effects ("Open Puppet Studio..."), close Studio on Apply
        // so RiokasPuppetingTools.aex immediately reloads live_frame.rpf and redraws the Solid Layer.
        if (ok && options?.closeIfAeModal && aeModal) {
          await fetch('/api/close-studio', { method: 'POST' }).catch(() => {});
          window.close();
        }

        return { synced: ok, aeModal, frameCount: animFrames.length };
      } catch (err) {
        console.error('[Rioka Studio Apply Sync Error]', err);
        return { synced: false, aeModal: false, frameCount: 0 };
      }
    },
    []
  );

  const handleOpenPluginWindow = useCallback(() => {
    sessionSnapshotRef.current = structuredClone(composition);
    setActiveView('plugin_window');
  }, [composition]);

  const handleCancelPluginWindow = useCallback(() => {
    if (sessionSnapshotRef.current) {
      setComposition(structuredClone(sessionSnapshotRef.current));
    }
    flashStatus('Reverted unsaved changes in Rioka Puppeting Tools.');
    void fetch('/api/standalone-info', { method: 'GET' })
      .then(async (res) => {
        const ct = res.headers.get('content-type') ?? '';
        if (!res.ok || !ct.includes('application/json')) return;
        const info = (await res.json()) as {
          standalone?: boolean;
          aeModal?: boolean;
        };
        if (info.standalone && info.aeModal) {
          await fetch('/api/close-studio', { method: 'POST' }).catch(() => {});
          window.close();
        }
      })
      .catch(() => {});
  }, [flashStatus]);

  const handleApplyPluginWindow = useCallback(() => {
    sessionSnapshotRef.current = structuredClone(composition);
    flashStatus('Rendering & applying puppet to After Effects Solid Layer...');
    void syncWithStandaloneOfflineHost(composition, activeEffect, {
      closeIfAeModal: true,
    }).then(({ synced, frameCount }) => {
      if (synced) {
        flashStatus(
          frameCount > 0
            ? `Applied puppet & ${frameCount} animated frame(s) to After Effects Solid Layer.`
            : 'Applied puppet RGBA frame & parameters to After Effects Solid Layer.'
        );
      } else {
        flashStatus('Applied puppet rig, morphs & keyframes — ready for After Effects.');
      }
    });
  }, [composition, activeEffect, syncWithStandaloneOfflineHost, flashStatus]);

  const handleExportAeKeyframes = useCallback(() => {
    downloadApplyKeyframesJsx(composition, activeEffect);
    void syncWithStandaloneOfflineHost(composition, activeEffect, {
      closeIfAeModal: false,
    });
    flashStatus(
      'Exported Rioka_Apply_Keyframes_To_AE.jsx — run via File → Scripts → Run Script File in After Effects.'
    );
  }, [composition, activeEffect, syncWithStandaloneOfflineHost, flashStatus]);

  // 4 User-requested Reset Actions
  const handleResetAllParameters = useCallback(() => {
    updateActivePuppet((doc) => ({
      ...doc,
      parameters: doc.parameters.map((p) => ({ ...p, value: p.defaultValue })),
    }));
    flashStatus('Reset All Parameters to default values.');
  }, [updateActivePuppet, flashStatus]);

  const handleResetAllKeyframes = useCallback(() => {
    updateActiveEffect((eff) => {
      const cleared: typeof eff.tracks = {};
      for (const [k, track] of Object.entries(eff.tracks)) {
        cleared[k] = { ...track, stopwatchEnabled: false, keyframes: [] };
      }
      return { ...eff, tracks: cleared };
    });
    flashStatus('Reset All Keyframes across timeline tracks.');
  }, [updateActiveEffect, flashStatus]);

  const handleResetAllPhysics = useCallback(() => {
    const freshDoc = createDefaultPuppetDocument();
    updateActiveEffect((eff) => ({
      ...eff,
      physicsEnabled: true,
      physicsStrength: 1.0,
      windStrength: 0.18,
      windTurbulence: 0.35,
      puppet: {
        ...eff.puppet,
        physicsGroups: freshDoc.physicsGroups,
      },
    }));
    flashStatus('Reset All Physics groups, delay, wind & pendulums.');
  }, [updateActiveEffect, flashStatus]);

  const handleResetAll = useCallback(() => {
    updateActiveEffect(() => createDefaultPuppetEffect());
    flashStatus('Reset All — restored original PSD rig, parameters, keyframes & physics.');
  }, [updateActiveEffect, flashStatus]);

  // After Effects Shared Memory & Disk Cache Purge
  const handlePurgeCache = useCallback(() => {
    cacheManager.purgeAllMemoryAndDiskCache(clearTextureBitmapCache);
    flashStatus(
      'Purged After Effects Memory & Rioka Disk Cache (0.0 MB cached).'
    );
  }, [flashStatus]);

  const handleApplyEffectToSelected = useCallback(() => {
    setComposition((prev) => ({
      ...prev,
      layers: prev.layers.map((layer) =>
        layer.id === prev.selectedLayerId
          ? { ...layer, effect: createDefaultPuppetEffect() }
          : layer
      ),
    }));
    flashStatus("Applied Rioka's Puppeting Tools effect.");
  }, [flashStatus]);

  const handleImportNewPsdFile = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const parsed = await parseRealPsdArrayBuffer(buffer, file.name);
        updateActiveEffect((eff) =>
          applyNewPsdImportToEffect(
            eff,
            parsed.layers,
            parsed.fileName,
            parsed.width,
            parsed.height
          )
        );
        flashStatus(
          `Imported new PSD "${file.name}" (${parsed.layers.length} layers) — parameters cleared & Auto-Breath turned OFF.`
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to parse PSD file.';
        flashStatus(`PSD import error: ${message}`);
      }
    },
    [updateActiveEffect, flashStatus]
  );

  const handleRenewPsdFile = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const parsed = await parseRealPsdArrayBuffer(buffer, file.name);
        updateActivePuppet((doc) => {
          const merged = mergeRenewedPsdLayers(
            doc,
            parsed.layers,
            parsed.fileName,
            parsed.width,
            parsed.height,
            'user-psd'
          );
          return {
            ...doc,
            layers: merged.layers,
            psd: merged.manifest,
          };
        });
        flashStatus(
          `Renewed PSD "${file.name}" (${parsed.layers.length} layers linked, rig preserved).`
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to parse PSD file.';
        flashStatus(`PSD import error: ${message}`);
      }
    },
    [updateActivePuppet, flashStatus]
  );

  const handleSimulatePsdUpdate = useCallback(() => {
    updateActivePuppet((doc) => {
      const nextVariant =
        doc.psd.sourceType === 'demo-classic' ? 'festival' : 'classic';
      const nextFileName =
        nextVariant === 'festival'
          ? `Rioka_Festival_Rev${doc.psd.revision + 1}.psd`
          : `Rioka_Classic_Rev${doc.psd.revision + 1}.psd`;
      const incoming = buildDemoPsdLayers(nextVariant);
      const merged = mergeRenewedPsdLayers(
        doc,
        incoming,
        nextFileName,
        2048,
        2048,
        nextVariant === 'festival' ? 'demo-festival' : 'demo-classic'
      );
      return {
        ...doc,
        layers: merged.layers,
        psd: merged.manifest,
      };
    });
    flashStatus(
      'PSD renewed: artwork & outfit updated while preserving all deformers, keyforms, and physics chains.'
    );
  }, [updateActivePuppet, flashStatus]);

  const handleImportProjectJson = useCallback(
    (jsonText: string) => {
      try {
        const parsed = JSON.parse(jsonText);
        if (!parsed?.puppet?.parameters || !parsed?.puppet?.physicsGroups) {
          throw new Error('Invalid .rpk.json project structure.');
        }
        updateActivePuppet((doc) => ({
          ...doc,
          name: parsed.puppet.name ?? doc.name,
          parameters: parsed.puppet.parameters,
          keyforms: parsed.puppet.keyforms ?? doc.keyforms,
          physicsGroups: parsed.puppet.physicsGroups,
          deformers: parsed.puppet.deformers ?? doc.deformers,
        }));
        flashStatus('Loaded .rpk.json rig and physics configuration.');
        setActiveView('plugin_window');
      } catch (err) {
        flashStatus(
          err instanceof Error ? err.message : 'Failed to parse project file.'
        );
      }
    },
    [updateActivePuppet, flashStatus]
  );

  // Full-screen Rioka Puppeting Tools floating-panel window (default launch view)
  if (activeView === 'plugin_window' && activeEffect) {
    return (
      <PluginWindowView
        composition={composition}
        effect={activeEffect}
        onChangeComposition={setComposition}
        onUpdateEffect={updateActiveEffect}
        onUpdatePuppet={updateActivePuppet}
        onImportNewPsdFile={handleImportNewPsdFile}
        onRenewPsdFile={handleRenewPsdFile}
        onSimulatePsdUpdate={handleSimulatePsdUpdate}
        onResetAllParameters={handleResetAllParameters}
        onResetAllKeyframes={handleResetAllKeyframes}
        onResetAllPhysics={handleResetAllPhysics}
        onResetAll={handleResetAll}
        onPurgeCache={handlePurgeCache}
        onCancel={handleCancelPluginWindow}
        onApply={handleApplyPluginWindow}
        onExportAeKeyframes={handleExportAeKeyframes}
        onNavigateView={(view) => {
          if (view === 'plugin_window') handleOpenPluginWindow();
          else setActiveView(view);
        }}
        statusMessage={statusMessage}
        onFlashStatus={flashStatus}
      />
    );
  }

  const handleTopPrimaryAction = () => {
    if (activeView === 'ae_sdk' && activeEffect) {
      void downloadAePluginZip(composition, activeEffect.puppet);
    } else {
      handleOpenPluginWindow();
    }
  };

  const primaryActionLabel =
    activeView === 'ae_sdk'
      ? 'Download Plugin Zip'
      : 'Open Rioka Puppeting Tools';

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden bg-[#1D1D1D] text-[#E8E8E8]"
      data-workspace={activeView}
    >
      <TopBar
        activeView={activeView}
        onSelectView={(v) => {
          if (v === 'plugin_window') handleOpenPluginWindow();
          else setActiveView(v);
        }}
        onPrimaryAction={handleTopPrimaryAction}
        primaryActionLabel={primaryActionLabel}
      />

      <main className="flex-1 flex min-h-0 overflow-hidden">
        {activeView === 'ae_sdk' && activeEffect && (
          <AeSdkView
            composition={composition}
            puppet={activeEffect.puppet}
            onImportProjectJson={handleImportProjectJson}
          />
        )}

        {!activeEffect && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <h2 className="text-[18px] font-semibold text-[#F0F0F0]">
              Rioka&apos;s Puppeting Tools Not Initialized
            </h2>
            <p className="text-[13px] text-[#9E9E9E] max-w-md">
              Initialize a Rioka puppet rig to open the studio workspace.
            </p>
            <button
              type="button"
              onClick={() => {
                handleApplyEffectToSelected();
                handleOpenPluginWindow();
              }}
              className="px-4 py-2 rounded-md bg-[#2D8CEB] hover:bg-[#1E7AD6] text-white text-[13px] font-medium transition-colors"
            >
              Initialize &amp; Open Rioka Puppeting Tools
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
