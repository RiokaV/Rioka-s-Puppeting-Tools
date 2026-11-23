import JSZip from 'jszip';
import type {
  CompositionState,
  PuppetDocument,
  RiokaPuppetEffect,
} from '../types/puppet';
import { renderPuppetEffectToRpf } from './rpfCodec';

export interface AeSdkFileEntry {
  path: string;
  language: 'cpp' | 'jsx' | 'xml' | 'cmake' | 'json' | 'markdown';
  summary: string;
  content: string;
}

/**
 * Serializes the current puppet rig, deformers, physics chains, and timeline tracks
 * into a portable .rpk.json document for local After Effects sync or project save.
 */
export function buildProjectJsonString(
  comp: CompositionState,
  puppet: PuppetDocument
): string {
  const activeLayer =
    comp.layers.find((l) => l.id === comp.selectedLayerId && l.effect !== null) ??
    comp.layers.find((l) => l.effect !== null);
  return JSON.stringify(
    {
      format: 'RiokaPuppetProject',
      version: '1.0',
      composition: {
        name: comp.name,
        width: comp.width,
        height: comp.height,
        fps: comp.fps,
        durationFrames: comp.durationFrames,
      },
      psd: puppet.psd,
      puppet: {
        id: puppet.id,
        name: puppet.name,
        modelWidth: puppet.modelWidth,
        modelHeight: puppet.modelHeight,
        deformers: puppet.deformers,
        parameters: puppet.parameters,
        keyforms: puppet.keyforms,
        physicsGroups: puppet.physicsGroups,
        layerCount: puppet.layers.length,
        layers: puppet.layers.map((l) => ({
          id: l.id,
          psdLayerName: l.psdLayerName,
          name: l.name,
          zIndex: l.zIndex,
          x: l.x,
          y: l.y,
          width: l.width,
          height: l.height,
          parentDeformerId: l.parentDeformerId,
          meshCols: l.meshCols,
          meshRows: l.meshRows,
        })),
      },
      tracks: activeLayer?.effect?.tracks ?? {},
    },
    null,
    2
  );
}

/**
 * Generates a standalone, runnable After Effects ExtendScript (.jsx) that applies
 * all current Rioka Puppeting Tools parameter values & timeline keyframes directly
 * onto the active Solid Layer in real Adobe After Effects (File -> Scripts -> Run Script File...).
 */
export function buildApplyKeyframesJsx(
  comp: CompositionState,
  effect: RiokaPuppetEffect | null
): string {
  const fps = Math.max(1, comp.fps || 30);
  const parameters = effect?.puppet.parameters ?? [];
  const tracks = effect?.tracks ?? {};

  const serializedParams = parameters.map((p) => {
    const track = tracks[p.id];
    const kfs = track
      ? [...track.keyframes]
          .sort((a, b) => a.frame - b.frame)
          .map((k) => ({
            time: Number((k.frame / fps).toFixed(4)),
            frame: k.frame,
            value: Number(k.value.toFixed(4)),
            easing: k.easing,
          }))
      : [];
    return {
      id: p.id,
      name: p.name,
      value: Number(p.value.toFixed(4)),
      keyframes: kfs,
    };
  });

  const animatedCount = serializedParams.filter((p) => p.keyframes.length > 0).length;

  return `// Rioka's Puppeting Tools — Apply Keyframes to Active After Effects Layer
// Run inside Adobe After Effects: File -> Scripts -> Run Script File...
// Generated from Rioka Puppeting Tools (${comp.width}x${comp.height} @ ${fps}fps, ${animatedCount} animated parameter track(s))

(function () {
    var RIOKA_PARAMS = ${JSON.stringify(serializedParams, null, 4)};

    var comp = app.project && app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        alert("Please open or select an After Effects Composition before running this script.");
        return;
    }

    var layer = comp.selectedLayers.length > 0 ? comp.selectedLayers[0] : null;
    if (!layer) {
        for (var i = 1; i <= comp.numLayers; i++) {
            var candidate = comp.layer(i);
            var fxParade = candidate.property("ADBE Effect Parade");
            if (fxParade && fxParade.property("Rioka's Puppeting Tools")) {
                layer = candidate;
                break;
            }
        }
    }

    app.beginUndoGroup("Apply Rioka Puppeting Tools Keyframes");
    try {
        if (!layer) {
            layer = comp.layers.addSolid([0.1, 0.12, 0.16], "Rioka Puppet Solid", comp.width, comp.height, 1.0);
        }

        var effects = layer.property("ADBE Effect Parade");
        var riokaEffect = effects.property("Rioka's Puppeting Tools");
        if (!riokaEffect) {
            try {
                riokaEffect = effects.addProperty("RIOKA PuppetingTools");
            } catch (e) {
                riokaEffect = null;
            }
        }

        var totalKeysApplied = 0;

        for (var pIdx = 0; pIdx < RIOKA_PARAMS.length; pIdx++) {
            var p = RIOKA_PARAMS[pIdx];
            var targetProp = null;

            if (riokaEffect) {
                try {
                    targetProp = riokaEffect.property(p.name);
                } catch (e) {
                    targetProp = null;
                }
            }

            // Fallback to native Expression Slider Control if the parameter isn't found on the native effect
            if (!targetProp && p.keyframes.length > 0) {
                var sliderName = "Rioka — " + p.name;
                var sliderFx = effects.property(sliderName);
                if (!sliderFx) {
                    sliderFx = effects.addProperty("ADBE Slider Control");
                    sliderFx.name = sliderName;
                }
                targetProp = sliderFx.property("ADBE Slider Control-0001");
            }

            if (!targetProp) continue;

            // Remove existing keyframes before applying fresh ones
            while (targetProp.numKeys > 0) {
                targetProp.removeKey(targetProp.numKeys);
            }

            if (p.keyframes.length > 0) {
                for (var k = 0; k < p.keyframes.length; k++) {
                    var kf = p.keyframes[k];
                    targetProp.setValueAtTime(kf.time, kf.value);
                    totalKeysApplied++;
                }
            } else {
                targetProp.setValue(p.value);
            }
        }

        alert("Rioka's Puppeting Tools: Applied " + totalKeysApplied + " keyframe(s) to layer \\"" + layer.name + "\\".");
    } catch (err) {
        alert("Rioka's Puppeting Tools script error: " + err.toString());
    } finally {
        app.endUndoGroup();
    }
})();
`;
}

export function downloadApplyKeyframesJsx(
  comp: CompositionState,
  effect: RiokaPuppetEffect | null
): string {
  const jsxContent = buildApplyKeyframesJsx(comp, effect);
  const fileName = 'Rioka_Apply_Keyframes_To_AE.jsx';
  const blob = new Blob([jsxContent], { type: 'text/javascript;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}

/**
 * Generates a real, compilable Adobe After Effects CC C++ Effect Plugin scaffold
 * (following the Element 3D / Trapcode Particular solid-layer PF_Cmd_RENDER + arbitrary data + external studio IPC pattern)
 * alongside a working CEP + ExtendScript (.jsx) live bridge and the exported .rpk.json puppet rig.
 */
export function buildAeSdkFiles(
  comp: CompositionState,
  puppet: PuppetDocument
): AeSdkFileEntry[] {
  const paramSetupLines = puppet.parameters
    .map(
      (p, i) =>
        `    AEFX_CLR_STRUCT(def);\n` +
        `    PF_ADD_FLOAT_SLIDERX("${p.name}", ${p.min.toFixed(1)}, ${p.max.toFixed(1)}, ${p.min.toFixed(1)}, ${p.max.toFixed(1)}, ${p.defaultValue.toFixed(1)}, PF_Precision_HUNDREDTHS, 0, 0, RIOKA_PARAM_${i + 1});`
    )
    .join('\n\n');

  const cppHeader = `#pragma once
#ifndef RIOKAS_PUPPETING_TOOLS_H
#define RIOKAS_PUPPETING_TOOLS_H

#include "AEConfig.h"
#include "entry.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include "AE_EffectCBSuites.h"
#include "String_Utils.h"
#include "AE_GeneralPlug.h"

#ifdef AE_OS_WIN
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #include <Windows.h>
    #include <shellapi.h>
    #include <commdlg.h>
#endif

#define RIOKA_PLUGIN_NAME        "Rioka's Puppeting Tools"
#define RIOKA_PLUGIN_CATEGORY    "Rioka Tools"
#define RIOKA_MATCH_NAME         "RIOKA PuppetingTools"
#define RIOKA_SUPPORT_URL        "https://riokapuppetingtools.local"

#define RIOKA_MAJOR_VERSION      1
#define RIOKA_MINOR_VERSION      0
#define RIOKA_BUG_VERSION        0
#define RIOKA_STAGE_VERSION      PF_Stage_RELEASE
#define RIOKA_BUILD_VERSION      1

// Must match AE_Effect_Global_OutFlags / OutFlags_2 in RiokasPuppetingToolsPiPL.r exactly!
// PF_OutFlag_DEEP_COLOR_AWARE (0x02000000) | PF_OutFlag_NON_PARAM_VARY (0x00000004) = 0x02000004 (33554436)
#define RIOKA_OUT_FLAGS          (PF_OutFlag_DEEP_COLOR_AWARE | PF_OutFlag_NON_PARAM_VARY)
#define RIOKA_OUT_FLAGS2         0x00000000

#define RIOKA_SEQ_MAGIC          0x524B5351u // "RKSQ"
#define RIOKA_SEQ_VERSION        1u

struct RiokaSequenceData {
    A_u_long magic;
    A_u_long version;
    char     instanceId[40];
};

enum {
    RIOKA_INPUT = 0,
    RIOKA_OPEN_STUDIO_BTN,
    RIOKA_PSD_RELOAD_BTN,
    RIOKA_PHYSICS_ENABLE,
    RIOKA_PHYSICS_STRENGTH,
    RIOKA_WIND_STRENGTH,
    RIOKA_RENDER_QUALITY,
${puppet.parameters.map((_, i) => `    RIOKA_PARAM_${i + 1},`).join('\n')}
    RIOKA_NUM_PARAMS
};

extern "C" {
    DllExport PF_Err PluginDataEntryFunction2(
        PF_PluginDataPtr inPtr,
        PF_PluginDataCB2 inPluginDataCallBackPtr,
        SPBasicSuite* inSPBasicSuitePtr,
        const char* inHostName,
        const char* inHostVersion
    );

    DllExport PF_Err EffectMain(
        PF_Cmd cmd,
        PF_InData *in_data,
        PF_OutData *out_data,
        PF_ParamDef *params[],
        PF_LayerDef *output,
        void *extra
    );
}

#endif // RIOKAS_PUPPETING_TOOLS_H
`;

  const cppSource = `// Rioka's Puppeting Tools — Adobe After Effects 2023+ Native C++ Effect Plugin
// Architecture: Solid-Layer Render Host (same pattern as Element 3D / Trapcode Particular)
// Renders live RGBA puppet frames from RiokaStudio.exe directly onto the After Effects Solid Layer
// across 8-bpc, 16-bpc, and 32-bpc compositions (multi-frame render thread-safe).

#include "RiokasPuppetingTools.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace fs = std::filesystem;

static constexpr uint32_t RIOKA_RPF_MAGIC = 0x4650524Bu; // "KRPF" little-endian
static constexpr size_t   RIOKA_RPF_HEADER_BYTES = 16;
static constexpr size_t   RIOKA_MAX_CACHED_FRAMES = 24;

struct RpfImage {
    uint32_t width = 0;
    uint32_t height = 0;
    std::vector<uint8_t> rgba;
};

struct CachedFrameEntry {
    std::string key;
    std::shared_ptr<const RpfImage> image;
};

struct AppliedParamsSnapshot {
    int frameCount = 0;
    int fps = 30;
    bool physicsEnabled = true;
    double physicsStrength = 1.0;
    double windStrength = 0.15;
    bool autoBreath = true;
    std::vector<double> params;
    bool loaded = false;
};

struct CachedParamsEntry {
    std::string key;
    AppliedParamsSnapshot snap;
};

static std::mutex g_cacheMutex;
static std::atomic<uint64_t> g_reloadEpoch{ 1 };
static std::atomic<uint64_t> g_instanceSeqCounter{ 1 };
static std::vector<CachedFrameEntry> g_frameCache;
static std::unordered_map<std::string, CachedParamsEntry> g_paramsCache;

static std::string SanitizeInstanceId(const char* raw) {
    std::string out;
    if (!raw) return "default";
    for (size_t i = 0; raw[i] != '\\0' && out.size() < 36; ++i) {
        const unsigned char c = static_cast<unsigned char>(raw[i]);
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '_' || c == '-') {
            out.push_back(static_cast<char>(c));
        }
    }
    return out.empty() ? std::string("default") : out;
}

static void GenerateUniqueInstanceId(char outBuf[40]) {
    uint64_t t1 = g_instanceSeqCounter.fetch_add(1);
    uint64_t t2 = 0;
    uint32_t pid = 0;
#ifdef AE_OS_WIN
    pid = static_cast<uint32_t>(GetCurrentProcessId());
    t2 = static_cast<uint64_t>(GetTickCount64());
    LARGE_INTEGER qpc{};
    if (QueryPerformanceCounter(&qpc)) {
        t2 ^= static_cast<uint64_t>(qpc.QuadPart);
    }
#endif
    std::ostringstream oss;
    oss << "rkl_" << std::hex << pid << "_" << t2 << "_" << t1;
    const std::string id = SanitizeInstanceId(oss.str().c_str());
    std::memset(outBuf, 0, 40);
    std::memcpy(outBuf, id.data(), (std::min)(id.size(), static_cast<size_t>(39)));
}

static std::string ReadSequenceInstanceId(PF_InData *in_data) {
    if (!in_data || !in_data->sequence_data) return "default";
    const RiokaSequenceData* seq = reinterpret_cast<const RiokaSequenceData*>(PF_LOCK_HANDLE(in_data->sequence_data));
    std::string id = "default";
    if (seq && seq->magic == RIOKA_SEQ_MAGIC && seq->instanceId[0] != '\\0') {
        id = SanitizeInstanceId(seq->instanceId);
    }
    PF_UNLOCK_HANDLE(in_data->sequence_data);
    return id;
}

#ifdef AE_OS_WIN
static std::string g_linkedPsdPath;

static fs::path GetPluginDirectory() {
    HMODULE hMod = NULL;
    if (GetModuleHandleExA(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            reinterpret_cast<LPCSTR>(&EffectMain),
            &hMod)) {
        char modPath[MAX_PATH] = { 0 };
        DWORD len = GetModuleFileNameA(hMod, modPath, MAX_PATH);
        if (len > 0 && len < MAX_PATH) {
            return fs::path(modPath).parent_path();
        }
    }
    return fs::current_path();
}

static fs::path GetBaseSyncDirectory() {
    char localAppData[MAX_PATH] = { 0 };
    if (GetEnvironmentVariableA("LOCALAPPDATA", localAppData, MAX_PATH) > 0) {
        return fs::path(localAppData) / "RiokaPuppetingTools";
    }
    return GetPluginDirectory() / "RiokaSync";
}

static fs::path GetInstanceSyncDirectory(const std::string& instanceId) {
    return GetBaseSyncDirectory() / "instances" / SanitizeInstanceId(instanceId.c_str());
}

static std::string MakeFileStampKey(const fs::path& p) {
    std::error_code ec;
    if (!fs::exists(p, ec) || !fs::is_regular_file(p, ec)) return {};
    const auto sz = fs::file_size(p, ec);
    const auto wt = fs::last_write_time(p, ec).time_since_epoch().count();
    std::ostringstream oss;
    oss << p.string() << "|" << sz << "|" << wt << "|" << g_reloadEpoch.load();
    return oss.str();
}

static AppliedParamsSnapshot LoadAppliedParamsCached(const fs::path& syncDir) {
    const fs::path paramsPath = syncDir / "applied_params.txt";
    const std::string pathKey = paramsPath.string();
    const std::string stampKey = MakeFileStampKey(paramsPath);

    {
        std::lock_guard<std::mutex> lock(g_cacheMutex);
        auto it = g_paramsCache.find(pathKey);
        if (!stampKey.empty() && it != g_paramsCache.end() &&
            it->second.key == stampKey && it->second.snap.loaded) {
            return it->second.snap;
        }
    }

    AppliedParamsSnapshot snap;
    if (stampKey.empty()) {
        std::lock_guard<std::mutex> lock(g_cacheMutex);
        g_paramsCache.erase(pathKey);
        return snap;
    }

    std::ifstream ifs(paramsPath);
    if (!ifs) return snap;

    std::string line;
    while (std::getline(ifs, line)) {
        const size_t eq = line.find('=');
        if (eq == std::string::npos) continue;
        const std::string k = line.substr(0, eq);
        const std::string v = line.substr(eq + 1);
        try {
            if (k == "frameCount") snap.frameCount = std::stoi(v);
            else if (k == "fps") snap.fps = (std::max)(1, std::stoi(v));
            else if (k == "physicsEnabled") snap.physicsEnabled = (std::stoi(v) != 0);
            else if (k == "physicsStrength") snap.physicsStrength = std::stod(v);
            else if (k == "windStrength") snap.windStrength = std::stod(v);
            else if (k == "autoBreath") snap.autoBreath = (std::stoi(v) != 0);
            else if (k.rfind("param_", 0) == 0) {
                const int idx = std::stoi(k.substr(6));
                if (idx >= 1 && idx <= 64) {
                    if (static_cast<size_t>(idx) > snap.params.size()) {
                        snap.params.resize(static_cast<size_t>(idx), 0.0);
                    }
                    snap.params[static_cast<size_t>(idx - 1)] = std::stod(v);
                }
            }
        } catch (...) {
            // ignore malformed numeric token
        }
    }
    snap.loaded = true;
    {
        std::lock_guard<std::mutex> lock(g_cacheMutex);
        g_paramsCache[pathKey] = CachedParamsEntry{ stampKey, snap };
    }
    return snap;
}

static std::shared_ptr<const RpfImage> LoadRpfImageCached(const fs::path& filePath) {
    const std::string key = MakeFileStampKey(filePath);
    if (key.empty()) return nullptr;

    {
        std::lock_guard<std::mutex> lock(g_cacheMutex);
        for (size_t i = 0; i < g_frameCache.size(); ++i) {
            if (g_frameCache[i].key == key && g_frameCache[i].image) {
                auto found = g_frameCache[i].image;
                if (i + 1 < g_frameCache.size()) {
                    CachedFrameEntry moved = std::move(g_frameCache[i]);
                    g_frameCache.erase(g_frameCache.begin() + static_cast<ptrdiff_t>(i));
                    g_frameCache.push_back(std::move(moved));
                }
                return found;
            }
        }
    }

    std::ifstream ifs(filePath, std::ios::binary);
    if (!ifs) return nullptr;

    uint32_t header[4] = { 0, 0, 0, 0 };
    ifs.read(reinterpret_cast<char*>(header), RIOKA_RPF_HEADER_BYTES);
    if (ifs.gcount() != static_cast<std::streamsize>(RIOKA_RPF_HEADER_BYTES)) return nullptr;

    const uint32_t magic = header[0];
    const uint32_t w = header[1];
    const uint32_t h = header[2];
    if (magic != RIOKA_RPF_MAGIC || w == 0 || h == 0 || w > 8192 || h > 8192) return nullptr;

    const size_t pixelBytes = static_cast<size_t>(w) * static_cast<size_t>(h) * 4u;
    auto img = std::make_shared<RpfImage>();
    img->width = w;
    img->height = h;
    img->rgba.resize(pixelBytes);
    ifs.read(reinterpret_cast<char*>(img->rgba.data()), static_cast<std::streamsize>(pixelBytes));
    if (static_cast<size_t>(ifs.gcount()) != pixelBytes) return nullptr;

    {
        std::lock_guard<std::mutex> lock(g_cacheMutex);
        if (g_frameCache.size() >= RIOKA_MAX_CACHED_FRAMES) {
            g_frameCache.erase(g_frameCache.begin());
        }
        g_frameCache.push_back(CachedFrameEntry{ key, img });
    }
    return img;
}

static bool LaunchPuppetStudioWindowModal(const std::string& instanceId) {
    const fs::path pluginDir = GetPluginDirectory();
    const std::vector<fs::path> candidates = {
        pluginDir / "RiokaStudio.exe",
        pluginDir / "RiokaStudio" / "RiokaStudio.exe",
        fs::path("C:/Program Files/Rioka's Puppeting Tools/RiokaStudio.exe"),
    };

    fs::path foundExe;
    for (const auto& exePath : candidates) {
        std::error_code ec;
        if (fs::exists(exePath, ec)) {
            foundExe = exePath;
            break;
        }
    }

    if (foundExe.empty()) {
        const std::string msg =
            "RiokaStudio.exe was not found next to RiokasPuppetingTools.aex.\\n\\n"
            "Please copy ALL 3 items ('RiokasPuppetingTools.aex', 'RiokaStudio.exe', and the 'studio' folder) into:\\n" +
            pluginDir.string();
        MessageBoxA(GetActiveWindow(), msg.c_str(), "Rioka's Puppeting Tools", MB_OK | MB_ICONINFORMATION);
        return false;
    }

    const std::string safeId = SanitizeInstanceId(instanceId.c_str());
    const std::string args = "--ae-modal --instance=" + safeId;
    std::string cmdLine = "\\"" + foundExe.string() + "\\" " + args;
    std::string workDir = foundExe.parent_path().string();
    std::vector<char> cmdBuf(cmdLine.begin(), cmdLine.end());
    cmdBuf.push_back('\\0');

    STARTUPINFOA si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};

    if (!CreateProcessA(
            NULL,
            cmdBuf.data(),
            NULL,
            NULL,
            FALSE,
            0,
            NULL,
            workDir.c_str(),
            &si,
            &pi)) {
        ShellExecuteA(NULL, "open", foundExe.string().c_str(), args.c_str(), workDir.c_str(), SW_SHOWNORMAL);
        return true;
    }

    // Modal wait (just like Element 3D / Magic Bullet Looks) while pumping WM_PAINT so AE redraws cleanly.
    // As soon as the user clicks Apply or Cancel in Rioka Studio, Studio exits and AE immediately re-renders.
    HWND aeMainHwnd = GetAncestor(GetActiveWindow(), GA_ROOT);
    bool disabledAe = false;
    if (aeMainHwnd && IsWindow(aeMainHwnd) && IsWindowEnabled(aeMainHwnd)) {
        EnableWindow(aeMainHwnd, FALSE);
        disabledAe = true;
    }

    for (;;) {
        const DWORD waitRes = MsgWaitForMultipleObjects(1, &pi.hProcess, FALSE, 50, QS_PAINT);
        if (waitRes == WAIT_OBJECT_0) {
            break;
        }
        MSG msg{};
        while (PeekMessageA(&msg, NULL, WM_PAINT, WM_PAINT, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageA(&msg);
        }
    }

    if (disabledAe && IsWindow(aeMainHwnd)) {
        EnableWindow(aeMainHwnd, TRUE);
        SetForegroundWindow(aeMainHwnd);
    }

    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return true;
}

static bool PickLinkedPsdFile(std::string& outPath) {
    char fileBuf[MAX_PATH] = { 0 };
    OPENFILENAMEA ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = GetActiveWindow();
    ofn.lpstrFilter = "Photoshop PSD (*.psd)\\0*.psd\\0Rioka Project (*.rpk.json)\\0*.rpk.json\\0All Files (*.*)\\0*.*\\0";
    ofn.lpstrFile = fileBuf;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrTitle = "Select Linked PSD or Rioka Project";
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    if (GetOpenFileNameA(&ofn)) {
        outPath = fileBuf;
        return true;
    }
    return false;
}
#endif

static PF_Err About(PF_InData *in_data, PF_OutData *out_data) {
    PF_SPRINTF(
        out_data->return_msg,
        "%s v%d.%d\\r2D Character Rigging, Renewable PSD ArtMeshes & Pendulum Physics.",
        RIOKA_PLUGIN_NAME,
        RIOKA_MAJOR_VERSION,
        RIOKA_MINOR_VERSION
    );
    return PF_Err_NONE;
}

static PF_Err GlobalSetup(PF_InData *in_data, PF_OutData *out_data) {
    (void)in_data;
    out_data->my_version = PF_VERSION(
        RIOKA_MAJOR_VERSION,
        RIOKA_MINOR_VERSION,
        RIOKA_BUG_VERSION,
        RIOKA_STAGE_VERSION,
        RIOKA_BUILD_VERSION
    );
    out_data->out_flags  = RIOKA_OUT_FLAGS;
    out_data->out_flags2 = RIOKA_OUT_FLAGS2;
    return PF_Err_NONE;
}

static PF_Err ParamsSetup(PF_InData *in_data, PF_OutData *out_data) {
    PF_Err err = PF_Err_NONE;
    PF_ParamDef def;

    AEFX_CLR_STRUCT(def);
    PF_ADD_BUTTON("Puppet Studio", "Open Puppet Studio...", 0, PF_ParamFlag_SUPERVISE, RIOKA_OPEN_STUDIO_BTN);

    AEFX_CLR_STRUCT(def);
    PF_ADD_BUTTON("PSD Live Link", "Renew Linked PSD...", 0, PF_ParamFlag_SUPERVISE, RIOKA_PSD_RELOAD_BTN);

    AEFX_CLR_STRUCT(def);
    PF_ADD_CHECKBOX("Physics Simulation", "Enable Pendulum Physics", TRUE, 0, RIOKA_PHYSICS_ENABLE);

    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Physics Strength", 0.0, 2.0, 0.0, 2.0, 1.0, PF_Precision_HUNDREDTHS, 0, 0, RIOKA_PHYSICS_STRENGTH);

    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Wind Strength", -2.0, 2.0, -2.0, 2.0, 0.15, PF_Precision_HUNDREDTHS, 0, 0, RIOKA_WIND_STRENGTH);

    AEFX_CLR_STRUCT(def);
    PF_ADD_POPUP("Render Quality", 3, 1, "Full|Half|Quarter", RIOKA_RENDER_QUALITY);

${paramSetupLines}

    out_data->num_params = RIOKA_NUM_PARAMS;
    return err;
}

static PF_Err SequenceSetup(PF_InData *in_data, PF_OutData *out_data) {
    PF_Handle seqH = PF_NEW_HANDLE(sizeof(RiokaSequenceData));
    if (!seqH) return PF_Err_OUT_OF_MEMORY;
    RiokaSequenceData* seq = reinterpret_cast<RiokaSequenceData*>(PF_LOCK_HANDLE(seqH));
    if (seq) {
        seq->magic = RIOKA_SEQ_MAGIC;
        seq->version = RIOKA_SEQ_VERSION;
        GenerateUniqueInstanceId(seq->instanceId);
        PF_UNLOCK_HANDLE(seqH);
    }
    out_data->sequence_data = seqH;
    return PF_Err_NONE;
}

static PF_Err SequenceResetup(PF_InData *in_data, PF_OutData *out_data) {
    if (in_data && in_data->sequence_data) {
        RiokaSequenceData* seq = reinterpret_cast<RiokaSequenceData*>(PF_LOCK_HANDLE(in_data->sequence_data));
        const bool valid = (seq && seq->magic == RIOKA_SEQ_MAGIC && seq->instanceId[0] != '\\0');
        PF_UNLOCK_HANDLE(in_data->sequence_data);
        if (valid) {
            out_data->sequence_data = in_data->sequence_data;
            return PF_Err_NONE;
        }
    }
    return SequenceSetup(in_data, out_data);
}

static PF_Err SequenceFlatten(PF_InData *in_data, PF_OutData *out_data) {
    (void)in_data;
    (void)out_data;
    return PF_Err_NONE;
}

static PF_Err SequenceSetdown(PF_InData *in_data, PF_OutData *out_data) {
    if (in_data && in_data->sequence_data) {
        PF_DISPOSE_HANDLE(in_data->sequence_data);
        if (out_data) out_data->sequence_data = NULL;
    }
    return PF_Err_NONE;
}

static PF_Err UserChangedParam(
    PF_InData *in_data,
    PF_OutData *out_data,
    PF_ParamDef *params[],
    const PF_UserChangedParamExtra *extra
) {
    if (extra->param_index == RIOKA_OPEN_STUDIO_BTN) {
#ifdef AE_OS_WIN
        const std::string instanceId = ReadSequenceInstanceId(in_data);
        if (LaunchPuppetStudioWindowModal(instanceId)) {
            g_reloadEpoch.fetch_add(1);
            const fs::path syncDir = GetInstanceSyncDirectory(instanceId);
            const AppliedParamsSnapshot applied = LoadAppliedParamsCached(syncDir);
            if (applied.loaded && params) {
                if (params[RIOKA_PHYSICS_ENABLE]) {
                    params[RIOKA_PHYSICS_ENABLE]->u.bd.value = applied.physicsEnabled ? TRUE : FALSE;
                    params[RIOKA_PHYSICS_ENABLE]->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
                }
                if (params[RIOKA_PHYSICS_STRENGTH]) {
                    params[RIOKA_PHYSICS_STRENGTH]->u.fs_d.value = applied.physicsStrength;
                    params[RIOKA_PHYSICS_STRENGTH]->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
                }
                if (params[RIOKA_WIND_STRENGTH]) {
                    params[RIOKA_WIND_STRENGTH]->u.fs_d.value = applied.windStrength;
                    params[RIOKA_WIND_STRENGTH]->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
                }
                const int paramStart = RIOKA_RENDER_QUALITY + 1;
                const int totalRigParams = RIOKA_NUM_PARAMS - paramStart;
                for (int i = 0; i < totalRigParams && i < static_cast<int>(applied.params.size()); ++i) {
                    PF_ParamDef* pDef = params[paramStart + i];
                    if (pDef) {
                        pDef->u.fs_d.value = applied.params[static_cast<size_t>(i)];
                        pDef->uu.change_flags |= PF_ChangeFlag_CHANGED_VALUE;
                    }
                }
            }
        }
#endif
        out_data->out_flags |= (PF_OutFlag_FORCE_RERENDER | PF_OutFlag_REFRESH_UI);
    } else if (extra->param_index == RIOKA_PSD_RELOAD_BTN) {
#ifdef AE_OS_WIN
        std::string selectedPath;
        if (PickLinkedPsdFile(selectedPath)) {
            g_linkedPsdPath = selectedPath;
            g_reloadEpoch.fetch_add(1);
        }
#endif
        out_data->out_flags |= PF_OutFlag_FORCE_RERENDER;
    }
    return PF_Err_NONE;
}

static std::string GetRiokaDiskCacheDirectory(PF_InData *in_data) {
    (void)in_data;
    return "Adobe/After Effects/Disk Cache/RiokaPuppetingTools_Cache";
}

static PF_Err GlobalSetdown(PF_InData *in_data, PF_OutData *out_data) {
    (void)out_data;
    const std::string cacheDir = GetRiokaDiskCacheDirectory(in_data);
    (void)cacheDir;
    std::lock_guard<std::mutex> lock(g_cacheMutex);
    g_frameCache.clear();
    g_paramsCache.clear();
    return PF_Err_NONE;
}

static PF_Err FrameSetdown(PF_InData *in_data, PF_OutData *out_data) {
    (void)in_data;
    (void)out_data;
    return PF_Err_NONE;
}

static inline void WritePremulRawPixel(
    PF_LayerDef* output,
    int x,
    int y,
    bool is16bpc,
    uint8_t rPremul,
    uint8_t gPremul,
    uint8_t bPremul,
    uint8_t a
) {
    if (is16bpc) {
        PF_Pixel16* row = reinterpret_cast<PF_Pixel16*>(
            reinterpret_cast<char*>(output->data) + static_cast<size_t>(y) * static_cast<size_t>(output->rowbytes)
        );
        row[x].alpha = static_cast<A_u_short>((static_cast<uint32_t>(a) * PF_MAX_CHAN16 + 127u) / 255u);
        row[x].red   = static_cast<A_u_short>((static_cast<uint32_t>(rPremul) * PF_MAX_CHAN16 + 127u) / 255u);
        row[x].green = static_cast<A_u_short>((static_cast<uint32_t>(gPremul) * PF_MAX_CHAN16 + 127u) / 255u);
        row[x].blue  = static_cast<A_u_short>((static_cast<uint32_t>(bPremul) * PF_MAX_CHAN16 + 127u) / 255u);
    } else {
        PF_Pixel8* row = reinterpret_cast<PF_Pixel8*>(
            reinterpret_cast<char*>(output->data) + static_cast<size_t>(y) * static_cast<size_t>(output->rowbytes)
        );
        row[x].alpha = static_cast<A_u_char>(a);
        row[x].red   = static_cast<A_u_char>(rPremul);
        row[x].green = static_cast<A_u_char>(gPremul);
        row[x].blue  = static_cast<A_u_char>(bPremul);
    }
}

static inline void WritePremulPixel(
    PF_LayerDef* output,
    int x,
    int y,
    bool is16bpc,
    uint8_t rStraight,
    uint8_t gStraight,
    uint8_t bStraight,
    uint8_t a
) {
    const uint8_t rPremul = static_cast<uint8_t>((static_cast<uint32_t>(rStraight) * a + 127u) / 255u);
    const uint8_t gPremul = static_cast<uint8_t>((static_cast<uint32_t>(gStraight) * a + 127u) / 255u);
    const uint8_t bPremul = static_cast<uint8_t>((static_cast<uint32_t>(bStraight) * a + 127u) / 255u);
    WritePremulRawPixel(output, x, y, is16bpc, rPremul, gPremul, bPremul, a);
}

// Built-in procedural character fallback if studio/default_puppet.rpf has not been copied yet
static void RenderFallbackCharacter(PF_LayerDef* output, bool is16bpc, double shiftXNorm, double rotRad) {
    const int outW = output->width;
    const int outH = output->height;
    const float cx = outW * 0.5f + static_cast<float>(shiftXNorm * outW * 0.08);
    const float cy = outH * 0.50f;
    const float unit = static_cast<float>((std::min)(outW, outH)) * 0.38f;
    const float cosR = std::cos(static_cast<float>(-rotRad));
    const float sinR = std::sin(static_cast<float>(-rotRad));

    for (int y = 0; y < outH; ++y) {
        for (int x = 0; x < outW; ++x) {
            const float dx = (static_cast<float>(x) - cx) / unit;
            const float dy = (static_cast<float>(y) - cy) / unit;
            const float lx = dx * cosR - dy * sinR;
            const float ly = dx * sinR + dy * cosR;

            uint8_t r = 0, g = 0, b = 0, a = 0;

            // Hair back silhouette
            const float hairD = (lx * lx) / (0.62f * 0.62f) + ((ly + 0.05f) * (ly + 0.05f)) / (0.78f * 0.78f);
            if (hairD <= 1.0f) {
                r = 34; g = 42; b = 68; a = 255;
            }
            // Shoulders / Sailor collar
            if (ly > 0.32f && ly < 1.08f && std::fabs(lx) < (0.52f + (ly - 0.32f) * 0.35f)) {
                r = 45; g = 104; b = 196; a = 255;
                if (std::fabs(lx) < 0.14f && ly < 0.72f) {
                    r = 228; g = 66; b = 96; a = 255; // Chest ribbon
                }
            }
            // Face oval
            const float faceD = (lx * lx) / (0.36f * 0.36f) + ((ly + 0.04f) * (ly + 0.04f)) / (0.42f * 0.42f);
            if (faceD <= 1.0f) {
                r = 254; g = 236; b = 224; a = 255;
                // Eyes
                const float elD = ((lx + 0.14f) * (lx + 0.14f)) / (0.06f * 0.06f) + ((ly + 0.02f) * (ly + 0.02f)) / (0.08f * 0.08f);
                const float erD = ((lx - 0.14f) * (lx - 0.14f)) / (0.06f * 0.06f) + ((ly + 0.02f) * (ly + 0.02f)) / (0.08f * 0.08f);
                if (elD <= 1.0f || erD <= 1.0f) {
                    r = 42; g = 98; b = 195; a = 255;
                }
            }
            // Front bangs cap
            const float bangD = (lx * lx) / (0.44f * 0.44f) + ((ly + 0.36f) * (ly + 0.36f)) / (0.28f * 0.28f);
            if (bangD <= 1.0f && ly < -0.10f) {
                r = 28; g = 36; b = 60; a = 255;
            }

            if (a > 0) {
                WritePremulPixel(output, x, y, is16bpc, r, g, b, a);
            }
        }
    }
}

static PF_Err Render(
    PF_InData *in_data,
    PF_OutData *out_data,
    PF_ParamDef *params[],
    PF_LayerDef *output
) {
    (void)out_data;
    if (!output || !output->data || output->rowbytes <= 0 || output->width <= 0 || output->height <= 0) {
        return PF_Err_NONE;
    }

    // Clear the Solid Layer buffer transparently before compositing the puppet
    std::memset(
        output->data,
        0,
        static_cast<size_t>(output->rowbytes) * static_cast<size_t>(output->height)
    );

    const bool is16bpc = ((output->world_flags & PF_WorldFlag_DEEP) != 0);

    // Read live AE Effect Control values (safe null-checked access)
    const int paramStart = RIOKA_RENDER_QUALITY + 1;
    auto readParam = [&](int offset, double fallback) -> double {
        const int idx = paramStart + offset;
        if (params && idx < RIOKA_NUM_PARAMS && params[idx]) {
            return params[idx]->u.fs_d.value;
        }
        return fallback;
    };

    const bool physEnabled = (params && params[RIOKA_PHYSICS_ENABLE])
        ? (params[RIOKA_PHYSICS_ENABLE]->u.bd.value != FALSE)
        : true;
    const double physStrength = (params && params[RIOKA_PHYSICS_STRENGTH])
        ? params[RIOKA_PHYSICS_STRENGTH]->u.fs_d.value
        : 1.0;
    const double windStrength = (params && params[RIOKA_WIND_STRENGTH])
        ? params[RIOKA_WIND_STRENGTH]->u.fs_d.value
        : 0.15;

    const double aeHeadX  = readParam(0, 0.0);
    const double aeHeadY  = readParam(1, 0.0);
    const double aeHeadZ  = readParam(2, 0.0);
    const double aeBodyX  = readParam(7, 0.0);
    const double aeBodyZ  = readParam(8, 0.0);
    const double aeBreath = readParam(11, 0.0);

    const double timeSec = (in_data && in_data->time_scale > 0)
        ? (static_cast<double>(in_data->current_time) / static_cast<double>(in_data->time_scale))
        : 0.0;
    const int currentFrame = (in_data && in_data->time_step > 0)
        ? static_cast<int>(in_data->current_time / in_data->time_step)
        : 0;

    std::shared_ptr<const RpfImage> frameImg;
    AppliedParamsSnapshot applied;
    int studioFrame = currentFrame;
    bool usingBakedAnimFrame = false;

#ifdef AE_OS_WIN
    const std::string instanceId = ReadSequenceInstanceId(in_data);
    const fs::path syncDir = GetInstanceSyncDirectory(instanceId);
    applied = LoadAppliedParamsCached(syncDir);

    // Sync Studio's FPS to real composition time so 24fps / 29.97fps / 30fps / 60fps AE comps play at exact speed
    if (applied.loaded && applied.fps > 0) {
        studioFrame = static_cast<int>(std::llround(timeSec * static_cast<double>(applied.fps)));
    }

    // Priority 1: Baked animated frame sequence exported by Rioka Studio for THIS Solid Layer instance
    if (applied.loaded && applied.frameCount > 0) {
        const int clampedFrame = (std::max)(0, (std::min)(applied.frameCount - 1, studioFrame));
        std::ostringstream fname;
        fname << "frame_" << std::setw(5) << std::setfill('0') << clampedFrame << ".rpf";
        frameImg = LoadRpfImageCached(syncDir / "frames" / fname.str());
        if (frameImg) {
            usingBakedAnimFrame = true;
        }
    }

    // Priority 2: Latest live applied frame for THIS Solid Layer instance
    if (!frameImg) {
        frameImg = LoadRpfImageCached(syncDir / "live_frame.rpf");
    }

    // Priority 3: Bundled default character frame next to .aex (renders immediately on any new Solid Layer!)
    if (!frameImg) {
        const fs::path pluginDir = GetPluginDirectory();
        frameImg = LoadRpfImageCached(pluginDir / "studio" / "default_puppet.rpf");
        if (!frameImg) {
            frameImg = LoadRpfImageCached(pluginDir / "default_puppet.rpf");
        }
    }
#endif

    // Compute live AE Effect Control delta relative to the applied Studio baseline so Apply is 1:1 exact
    // while dragging AE sliders directly still moves/rotates/breathes the puppet in real time.
    auto baseParam = [&](size_t idx) -> double {
        return (applied.loaded && idx < applied.params.size()) ? applied.params[idx] : 0.0;
    };
    const double dHeadX  = aeHeadX  - baseParam(0);
    const double dHeadY  = aeHeadY  - baseParam(1);
    const double dHeadZ  = aeHeadZ  - baseParam(2);
    const double dBodyX  = aeBodyX  - baseParam(7);
    const double dBodyZ  = aeBodyZ  - baseParam(8);
    const double dBreath = aeBreath - baseParam(11);

    // Live breathing on the Solid Layer:
    // - Always active on newly dropped Solid Layers (default_puppet.rpf) & static poses (frameCount == 0)
    // - Seamlessly continues phase-matched breathing after the last baked keyframe (studioFrame >= frameCount)
    // - Baked animated frames already include exact rig breathing during [0, frameCount - 1]
    double liveBreath = 0.0;
    if (applied.autoBreath) {
        if (!usingBakedAnimFrame) {
            liveBreath = (0.5 + 0.5 * std::sin(timeSec * 2.0)) * 0.7;
        } else if (applied.frameCount > 0 && studioFrame >= applied.frameCount) {
            const double endSec = static_cast<double>(applied.frameCount - 1) / static_cast<double>((std::max)(1, applied.fps));
            const double breathAtEnd = (0.5 + 0.5 * std::sin(endSec * 2.0)) * 0.7;
            const double breathNow   = (0.5 + 0.5 * std::sin(timeSec * 2.0)) * 0.7;
            liveBreath = breathNow - breathAtEnd;
        }
    }
    const double totalBreath = liveBreath + dBreath;

    const double shiftXNorm   = (dHeadX / 30.0) * 0.06 + (dBodyX / 10.0) * 0.04;
    const double shiftYNorm   = (-dHeadY / 30.0) * 0.05;
    const double rotRad       = ((dHeadZ * 0.45) + (dBodyZ * 0.85)) * (3.14159265358979323846 / 180.0);
    const double breathScaleY = 1.0 + totalBreath * 0.022;
    const double breathScaleX = 1.0 + totalBreath * 0.010;
    const double breathLiftY  = -totalBreath * 0.008;

    (void)physEnabled;
    (void)physStrength;
    (void)windStrength;

    if (!frameImg || frameImg->width == 0 || frameImg->height == 0) {
        RenderFallbackCharacter(output, is16bpc, shiftXNorm, rotRad);
        return PF_Err_NONE;
    }

    const int outW = output->width;
    const int outH = output->height;
    const int srcW = static_cast<int>(frameImg->width);
    const int srcH = static_cast<int>(frameImg->height);
    const uint8_t* srcRgba = frameImg->rgba.data();

    const float fitScale = (std::min)(
        static_cast<float>(outW) / static_cast<float>(srcW),
        static_cast<float>(outH) / static_cast<float>(srcH)
    );
    const float invFitScale = (fitScale > 1e-5f) ? (1.0f / fitScale) : 1.0f;
    const float outCenterX = outW * 0.5f + static_cast<float>(shiftXNorm * outW);
    const float outCenterY = outH * 0.5f + static_cast<float>(shiftYNorm * outH);
    const float breathAnchorY = outH * 0.90f;
    const float breathLiftPx = static_cast<float>(breathLiftY * outH);
    const float srcCenterX = srcW * 0.5f;
    const float srcCenterY = srcH * 0.5f;
    const float cosR = std::cos(static_cast<float>(-rotRad));
    const float sinR = std::sin(static_cast<float>(-rotRad));
    const float invBreathX = static_cast<float>(1.0 / (std::max)(0.5, breathScaleX));
    const float invBreathY = static_cast<float>(1.0 / (std::max)(0.5, breathScaleY));

    for (int y = 0; y < outH; ++y) {
        // Bottom-anchored torso breathing so shoulders & head rise cleanly without detaching from the bottom frame
        const float yUnbreathed = breathAnchorY + ((static_cast<float>(y) + 0.5f - breathLiftPx) - breathAnchorY) * invBreathY;
        const float dyOut = (yUnbreathed - outCenterY) * invFitScale;
        for (int x = 0; x < outW; ++x) {
            const float xUnbreathed = outCenterX + (static_cast<float>(x) + 0.5f - outCenterX) * invBreathX;
            const float dxOut = (xUnbreathed - outCenterX) * invFitScale;
            const float sx = srcCenterX + dxOut * cosR - dyOut * sinR - 0.5f;
            const float sy = srcCenterY + dxOut * sinR + dyOut * cosR - 0.5f;

            if (sx < -0.5f || sy < -0.5f || sx > static_cast<float>(srcW) - 0.5f || sy > static_cast<float>(srcH) - 0.5f) {
                continue;
            }

            const int x0 = (std::max)(0, (std::min)(srcW - 1, static_cast<int>(std::floor(sx))));
            const int y0 = (std::max)(0, (std::min)(srcH - 1, static_cast<int>(std::floor(sy))));
            const int x1 = (std::min)(srcW - 1, x0 + 1);
            const int y1 = (std::min)(srcH - 1, y0 + 1);
            const float fx = (std::max)(0.0f, (std::min)(1.0f, sx - static_cast<float>(x0)));
            const float fy = (std::max)(0.0f, (std::min)(1.0f, sy - static_cast<float>(y0)));

            const size_t i00 = (static_cast<size_t>(y0) * static_cast<size_t>(srcW) + static_cast<size_t>(x0)) * 4u;
            const size_t i10 = (static_cast<size_t>(y0) * static_cast<size_t>(srcW) + static_cast<size_t>(x1)) * 4u;
            const size_t i01 = (static_cast<size_t>(y1) * static_cast<size_t>(srcW) + static_cast<size_t>(x0)) * 4u;
            const size_t i11 = (static_cast<size_t>(y1) * static_cast<size_t>(srcW) + static_cast<size_t>(x1)) * 4u;

            const float w00 = (1.0f - fx) * (1.0f - fy);
            const float w10 = fx * (1.0f - fy);
            const float w01 = (1.0f - fx) * fy;
            const float w11 = fx * fy;

            // Premultiply each straight RGBA texel BEFORE bilinear filtering (prevents dark edge halo!)
            const float a00 = static_cast<float>(srcRgba[i00 + 3]);
            const float a10 = static_cast<float>(srcRgba[i10 + 3]);
            const float a01 = static_cast<float>(srcRgba[i01 + 3]);
            const float a11 = static_cast<float>(srcRgba[i11 + 3]);

            const float af = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
            const uint8_t a = static_cast<uint8_t>((std::max)(0.0f, (std::min)(255.0f, af + 0.5f)));
            if (a == 0) continue;

            const float inv255 = 1.0f / 255.0f;
            const float pm00 = w00 * a00 * inv255;
            const float pm10 = w10 * a10 * inv255;
            const float pm01 = w01 * a01 * inv255;
            const float pm11 = w11 * a11 * inv255;

            const float rf = srcRgba[i00 + 0] * pm00 + srcRgba[i10 + 0] * pm10 + srcRgba[i01 + 0] * pm01 + srcRgba[i11 + 0] * pm11;
            const float gf = srcRgba[i00 + 1] * pm00 + srcRgba[i10 + 1] * pm10 + srcRgba[i01 + 1] * pm01 + srcRgba[i11 + 1] * pm11;
            const float bf = srcRgba[i00 + 2] * pm00 + srcRgba[i10 + 2] * pm10 + srcRgba[i01 + 2] * pm01 + srcRgba[i11 + 2] * pm11;

            const uint8_t rP = static_cast<uint8_t>((std::max)(0.0f, (std::min)(static_cast<float>(a), rf + 0.5f)));
            const uint8_t gP = static_cast<uint8_t>((std::max)(0.0f, (std::min)(static_cast<float>(a), gf + 0.5f)));
            const uint8_t bP = static_cast<uint8_t>((std::max)(0.0f, (std::min)(static_cast<float>(a), bf + 0.5f)));

            WritePremulRawPixel(output, x, y, is16bpc, rP, gP, bP, a);
        }
    }

    return PF_Err_NONE;
}

// Required in Adobe After Effects SDK 2023+ to register the effect at host startup
extern "C" DllExport PF_Err PluginDataEntryFunction2(
    PF_PluginDataPtr inPtr,
    PF_PluginDataCB2 inPluginDataCallBackPtr,
    SPBasicSuite* inSPBasicSuitePtr,
    const char* inHostName,
    const char* inHostVersion
) {
    (void)inSPBasicSuitePtr;
    (void)inHostName;
    (void)inHostVersion;
    PF_Err result = PF_Err_INVALID_CALLBACK;
    result = PF_REGISTER_EFFECT_EXT2(
        inPtr,
        inPluginDataCallBackPtr,
        RIOKA_PLUGIN_NAME,      // Display Name
        RIOKA_MATCH_NAME,       // Unique Match Name
        RIOKA_PLUGIN_CATEGORY,  // Effect Menu Category
        AE_RESERVED_INFO,       // Reserved Info
        "EffectMain",           // Entry point
        RIOKA_SUPPORT_URL       // Support URL
    );
    return result;
}

extern "C" DllExport PF_Err EffectMain(
    PF_Cmd cmd,
    PF_InData *in_data,
    PF_OutData *out_data,
    PF_ParamDef *params[],
    PF_LayerDef *output,
    void *extra
) {
    switch (cmd) {
        case PF_Cmd_ABOUT:              return About(in_data, out_data);
        case PF_Cmd_GLOBAL_SETUP:       return GlobalSetup(in_data, out_data);
        case PF_Cmd_GLOBAL_SETDOWN:     return GlobalSetdown(in_data, out_data);
        case PF_Cmd_PARAMS_SETUP:       return ParamsSetup(in_data, out_data);
        case PF_Cmd_SEQUENCE_SETUP:     return SequenceSetup(in_data, out_data);
        case PF_Cmd_SEQUENCE_RESETUP:   return SequenceResetup(in_data, out_data);
        case PF_Cmd_SEQUENCE_FLATTEN:   return SequenceFlatten(in_data, out_data);
        case PF_Cmd_SEQUENCE_SETDOWN:   return SequenceSetdown(in_data, out_data);
        case PF_Cmd_FRAME_SETDOWN:      return FrameSetdown(in_data, out_data);
        case PF_Cmd_USER_CHANGED_PARAM: return UserChangedParam(in_data, out_data, params, reinterpret_cast<PF_UserChangedParamExtra*>(extra));
        case PF_Cmd_RENDER:             return Render(in_data, out_data, params, output);
        default:                        return PF_Err_NONE;
    }
}
`;

  const piplResource = `#include "AEConfig.h"
#include "AE_EffectVers.h"

#ifndef AE_OS_WIN
    #include <AE_General.r>
#endif

resource 'PiPL' (16000) {
    {
        /* [1] */
        Kind {
            AEEffect
        },
        /* [2] */
        Name {
            "Rioka's Puppeting Tools"
        },
        /* [3] */
        Category {
            "Rioka Tools"
        },
#ifdef AE_OS_WIN
    #ifdef AE_PROC_INTELx64
        CodeWin64X86 {"EffectMain"},
    #endif
#else
    #ifdef AE_OS_MAC
        CodeMacIntel64 {"EffectMain"},
        CodeMacARM64 {"EffectMain"},
    #endif
#endif
        /* [6] */
        AE_PiPL_Version {
            2,
            0
        },
        /* [7] */
        AE_Effect_Spec_Version {
            PF_PLUG_IN_VERSION,
            PF_PLUG_IN_SUBVERS
        },
        /* [8] Version: Major=1, Minor=0, Bug=0, Stage=RELEASE(3), Build=1 -> 0x00080601 = 525825 */
        AE_Effect_Version {
            525825
        },
        /* [9] */
        AE_Effect_Info_Flags {
            0
        },
        /* [10] Must match RIOKA_OUT_FLAGS in RiokasPuppetingTools.h (0x02000004) */
        AE_Effect_Global_OutFlags {
            0x02000004
        },
        /* [11] Must match RIOKA_OUT_FLAGS2 in RiokasPuppetingTools.h (0x00000000) */
        AE_Effect_Global_OutFlags_2 {
            0x00000000
        },
        /* [12] */
        AE_Effect_Match_Name {
            "RIOKA PuppetingTools"
        },
        /* [13] */
        AE_Reserved_Info {
            0
        },
        /* [14] */
        AE_Effect_Support_URL {
            "https://riokapuppetingtools.local"
        }
    }
};
`;

  const studioExeSource = `// RiokaStudio.exe — Standalone 100% Offline Desktop Studio for Rioka's Puppeting Tools
// Launched automatically by RiokasPuppetingTools.aex (just like Element 3D, Particular & Magic Bullet Looks)
// or by double-clicking RiokaStudio.exe directly. Requires ZERO Google login and ZERO internet.

#ifndef NOMINMAX
#define NOMINMAX
#endif
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

static std::atomic<bool> g_running{ true };
static std::atomic<bool> g_closeRequested{ false };
static std::atomic<bool> g_clientConnected{ false };
static std::atomic<bool> g_clientUnloaded{ false };
static std::atomic<uint64_t> g_lastHeartbeatTick{ 0 };
static std::atomic<bool> g_aeModal{ false };
static std::string g_instanceId = "default";

static std::string SanitizeInstanceId(const std::string& raw) {
    std::string out;
    for (size_t i = 0; i < raw.size() && out.size() < 36; ++i) {
        const unsigned char c = static_cast<unsigned char>(raw[i]);
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '_' || c == '-') {
            out.push_back(static_cast<char>(c));
        }
    }
    return out.empty() ? std::string("default") : out;
}

static std::string GetContentType(const fs::path& p) {
    std::string ext = p.extension().string();
    for (char& c : ext) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (ext == ".html" || ext == ".htm") return "text/html; charset=utf-8";
    if (ext == ".js" || ext == ".mjs")   return "application/javascript; charset=utf-8";
    if (ext == ".css")                   return "text/css; charset=utf-8";
    if (ext == ".json")                  return "application/json; charset=utf-8";
    if (ext == ".svg")                   return "image/svg+xml";
    if (ext == ".png")                   return "image/png";
    if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
    if (ext == ".wasm")                  return "application/wasm";
    return "application/octet-stream";
}

static bool SendAll(SOCKET sock, const char* data, size_t len) {
    size_t sentTotal = 0;
    while (sentTotal < len) {
        const int chunk = static_cast<int>((len - sentTotal) > 65536 ? 65536 : (len - sentTotal));
        const int n = send(sock, data + sentTotal, chunk, 0);
        if (n <= 0) return false;
        sentTotal += static_cast<size_t>(n);
    }
    return true;
}

static std::string UrlDecode(const std::string& in) {
    std::string out;
    out.reserve(in.size());
    for (size_t i = 0; i < in.size(); ++i) {
        if (in[i] == '%' && i + 2 < in.size()) {
            char hex[3] = { in[i + 1], in[i + 2], 0 };
            char* end = nullptr;
            long val = std::strtol(hex, &end, 16);
            if (end == hex + 2) {
                out.push_back(static_cast<char>(val));
                i += 2;
                continue;
            }
        }
        out.push_back(in[i]);
    }
    return out;
}

static fs::path GetBaseAppDataDirectory() {
    char localAppData[MAX_PATH] = { 0 };
    if (GetEnvironmentVariableA("LOCALAPPDATA", localAppData, MAX_PATH) > 0) {
        return fs::path(localAppData) / "RiokaPuppetingTools";
    }
    return fs::current_path() / "RiokaSync";
}

static fs::path GetLocalSyncDirectory() {
    fs::path dir = GetBaseAppDataDirectory() / "instances" / SanitizeInstanceId(g_instanceId);
    std::error_code ec;
    fs::create_directories(dir, ec);
    return dir;
}

static bool WriteFileAtomic(const fs::path& targetPath, const std::string& bytes) {
    std::error_code ec;
    fs::create_directories(targetPath.parent_path(), ec);
    const fs::path tmpPath = targetPath.string() + ".tmp";
    std::ofstream ofs(tmpPath, std::ios::binary | std::ios::trunc);
    if (!ofs) return false;
    if (!bytes.empty()) {
        ofs.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    }
    ofs.close();
    if (!ofs) return false;
    return MoveFileExA(tmpPath.string().c_str(), targetPath.string().c_str(), MOVEFILE_REPLACE_EXISTING) != 0;
}

// Returns PIDs strictly belonging to our isolated Studio Job Object (NEVER touches user browsers)
static std::vector<DWORD> QueryJobProcessIds(HANDLE hJob) {
    std::vector<DWORD> result;
    if (!hJob) return result;
    const size_t cap = 64;
    std::vector<BYTE> buf(sizeof(JOBOBJECT_BASIC_PROCESS_ID_LIST) + cap * sizeof(ULONG_PTR), 0);
    if (!QueryInformationJobObject(
            hJob,
            JobObjectBasicProcessIdList,
            buf.data(),
            static_cast<DWORD>(buf.size()),
            NULL)) {
        return result;
    }
    const auto* list = reinterpret_cast<const JOBOBJECT_BASIC_PROCESS_ID_LIST*>(buf.data());
    for (DWORD i = 0; i < list->NumberOfProcessIdsInList; ++i) {
        result.push_back(static_cast<DWORD>(list->ProcessIdList[i]));
    }
    return result;
}

// Closes ONLY top-level windows owned by our isolated Studio Job Object (never Opera/Chrome/Edge user windows)
static void CloseOwnedStudioWindows(HANDLE hJob) {
    const std::vector<DWORD> pids = QueryJobProcessIds(hJob);
    if (pids.empty()) return;
    struct CloseCtx {
        const std::vector<DWORD>* pids;
    };
    CloseCtx ctx{ &pids };
    EnumWindows([](HWND hwnd, LPARAM lParam) -> BOOL {
        auto* c = reinterpret_cast<CloseCtx*>(lParam);
        DWORD wpid = 0;
        GetWindowThreadProcessId(hwnd, &wpid);
        if (std::find(c->pids->begin(), c->pids->end(), wpid) != c->pids->end()) {
            PostMessageA(hwnd, WM_CLOSE, 0, 0);
        }
        return TRUE;
    }, reinterpret_cast<LPARAM>(&ctx));
}

static bool HasVisibleOwnedStudioWindow(HANDLE hJob) {
    const std::vector<DWORD> pids = QueryJobProcessIds(hJob);
    if (pids.empty()) return false;
    struct CheckCtx {
        const std::vector<DWORD>* pids;
        bool visible = false;
    };
    CheckCtx ctx{ &pids, false };
    EnumWindows([](HWND hwnd, LPARAM lParam) -> BOOL {
        if (!IsWindowVisible(hwnd)) return TRUE;
        auto* c = reinterpret_cast<CheckCtx*>(lParam);
        DWORD wpid = 0;
        GetWindowThreadProcessId(hwnd, &wpid);
        if (std::find(c->pids->begin(), c->pids->end(), wpid) != c->pids->end()) {
            c->visible = true;
            return FALSE;
        }
        return TRUE;
    }, reinterpret_cast<LPARAM>(&ctx));
    return ctx.visible;
}

static void SendJsonResponse(SOCKET client, int statusCode, const std::string& statusText, const std::string& jsonBody) {
    std::ostringstream hdr;
    hdr << "HTTP/1.1 " << statusCode << " " << statusText << "\\r\\n"
        << "Content-Type: application/json; charset=utf-8\\r\\n"
        << "Content-Length: " << jsonBody.size() << "\\r\\n"
        << "Cache-Control: no-store\\r\\n"
        << "Connection: close\\r\\n\\r\\n";
    const std::string hdrStr = hdr.str();
    SendAll(client, hdrStr.data(), hdrStr.size());
    if (!jsonBody.empty()) {
        SendAll(client, jsonBody.data(), jsonBody.size());
    }
}

static void HandleHttpClient(SOCKET client, const fs::path& studioRoot) {
    std::string rawRequest;
    rawRequest.reserve(8192);
    char chunk[4096];
    size_t headerEnd = std::string::npos;

    while (headerEnd == std::string::npos && rawRequest.size() < 65536) {
        const int n = recv(client, chunk, sizeof(chunk), 0);
        if (n <= 0) break;
        rawRequest.append(chunk, static_cast<size_t>(n));
        headerEnd = rawRequest.find("\\r\\n\\r\\n");
    }

    if (rawRequest.empty() || headerEnd == std::string::npos) {
        closesocket(client);
        return;
    }

    const std::string headerBlock = rawRequest.substr(0, headerEnd);
    std::string bodyData = rawRequest.substr(headerEnd + 4);

    std::istringstream reqStream(headerBlock);
    std::string method, rawTarget;
    reqStream >> method >> rawTarget;

    size_t contentLength = 0;
    std::string headerLine;
    std::getline(reqStream, headerLine);
    while (std::getline(reqStream, headerLine)) {
        std::string lowerLine = headerLine;
        for (char& c : lowerLine) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        if (lowerLine.rfind("content-length:", 0) == 0) {
            contentLength = static_cast<size_t>(std::strtoull(headerLine.c_str() + 15, nullptr, 10));
        }
    }

    const size_t maxBodyBytes = 32u * 1024u * 1024u;
    if (contentLength > maxBodyBytes) contentLength = maxBodyBytes;
    while (bodyData.size() < contentLength) {
        const int n = recv(client, chunk, sizeof(chunk), 0);
        if (n <= 0) break;
        bodyData.append(chunk, static_cast<size_t>(n));
    }
    if (bodyData.size() > contentLength && contentLength > 0) {
        bodyData.resize(contentLength);
    }

    const size_t qPos = rawTarget.find('?');
    const std::string routePath = (qPos == std::string::npos) ? rawTarget : rawTarget.substr(0, qPos);
    const std::string queryStr  = (qPos == std::string::npos) ? "" : rawTarget.substr(qPos + 1);

    // Every valid HTTP request from our Studio window keeps the session heartbeat fresh
    g_clientConnected.store(true);
    g_lastHeartbeatTick.store(GetTickCount64());

    // Local 100% offline loopback endpoints for per-Solid-Layer RGBA, rig & animation state sync
    if (method == "GET" && routePath == "/api/standalone-info") {
        const std::string infoJson = std::string("{\\"standalone\\":true,\\"offline\\":true,\\"aeModal\\":")
            + (g_aeModal.load() ? "true" : "false")
            + ",\\"instanceId\\":\\"" + SanitizeInstanceId(g_instanceId) + "\\"}";
        SendJsonResponse(client, 200, "OK", infoJson);
        shutdown(client, SD_SEND);
        closesocket(client);
        return;
    }

    if (method == "POST" && routePath == "/api/studio-heartbeat") {
        SendJsonResponse(client, 200, "OK", "{\\"ok\\":true}");
        shutdown(client, SD_SEND);
        closesocket(client);
        return;
    }

    if (method == "POST" && routePath == "/api/studio-unload") {
        g_clientUnloaded.store(true);
        SendJsonResponse(client, 200, "OK", "{\\"ok\\":true}");
        shutdown(client, SD_SEND);
        closesocket(client);
        return;
    }

    if (method == "GET" && routePath == "/api/load-studio-state") {
        const fs::path statePath = GetLocalSyncDirectory() / "studio_state.json";
        std::error_code ec;
        if (fs::exists(statePath, ec) && fs::is_regular_file(statePath, ec)) {
            std::ifstream ifs(statePath, std::ios::binary);
            if (ifs) {
                std::string saved((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
                if (!saved.empty()) {
                    SendJsonResponse(client, 200, "OK", saved);
                    shutdown(client, SD_SEND);
                    closesocket(client);
                    return;
                }
            }
        }
        SendJsonResponse(client, 200, "OK", "{\\"found\\":false}");
        shutdown(client, SD_SEND);
        closesocket(client);
        return;
    }

    if (method == "POST" && routePath == "/api/save-studio-state") {
        const bool ok = WriteFileAtomic(GetLocalSyncDirectory() / "studio_state.json", bodyData);
        SendJsonResponse(client, ok ? 200 : 500, ok ? "OK" : "Internal Server Error", ok ? "{\\"ok\\":true}" : "{\\"ok\\":false}");
        shutdown(client, SD_SEND);
        closesocket(client);
        return;
    }

    if (method == "POST" && routePath == "/api/apply-frame-rgba") {
        const bool ok = WriteFileAtomic(GetLocalSyncDirectory() / "live_frame.rpf", bodyData);
        SendJsonResponse(client, ok ? 200 : 500, ok ? "OK" : "Internal Server Error", ok ? "{\\"ok\\":true}" : "{\\"ok\\":false}");
        shutdown(client, SD_SEND);
        closesocket(client);
        return;
    }

    if (method == "POST" && routePath == "/api/apply-params-txt") {
        const bool ok = WriteFileAtomic(GetLocalSyncDirectory() / "applied_params.txt", bodyData);
        SendJsonResponse(client, ok ? 200 : 500, ok ? "OK" : "Internal Server Error", ok ? "{\\"ok\\":true}" : "{\\"ok\\":false}");
        shutdown(client, SD_SEND);
        closesocket(client);
        return;
    }

    if (method == "POST" && routePath == "/api/clear-anim-frames") {
        const fs::path framesDir = GetLocalSyncDirectory() / "frames";
        std::error_code ec;
        if (fs::exists(framesDir, ec)) {
            for (const auto& entry : fs::directory_iterator(framesDir, ec)) {
                if (entry.is_regular_file(ec) && entry.path().extension() == ".rpf") {
                    fs::remove(entry.path(), ec);
                }
            }
        } else {
            fs::create_directories(framesDir, ec);
        }
        SendJsonResponse(client, 200, "OK", "{\\"ok\\":true}");
        shutdown(client, SD_SEND);
        closesocket(client);
        return;
    }

    if (method == "POST" && routePath == "/api/apply-anim-frame") {
        int frameIndex = 0;
        const size_t idxPos = queryStr.find("index=");
        if (idxPos != std::string::npos) {
            frameIndex = std::atoi(queryStr.c_str() + idxPos + 6);
        }
        if (frameIndex < 0) frameIndex = 0;
        if (frameIndex > 99999) frameIndex = 99999;
        std::ostringstream fname;
        fname << "frame_" << std::setw(5) << std::setfill('0') << frameIndex << ".rpf";
        const bool ok = WriteFileAtomic(GetLocalSyncDirectory() / "frames" / fname.str(), bodyData);
        SendJsonResponse(client, ok ? 200 : 500, ok ? "OK" : "Internal Server Error", ok ? "{\\"ok\\":true}" : "{\\"ok\\":false}");
        shutdown(client, SD_SEND);
        closesocket(client);
        return;
    }

    if (method == "POST" && (routePath == "/api/apply-rig-json" || routePath == "/api/apply-keyframes-jsx")) {
        const fs::path syncDir = GetLocalSyncDirectory();
        const fs::path outPath = (routePath == "/api/apply-rig-json")
            ? (syncDir / "applied_rig.rpk.json")
            : (syncDir / "apply_keyframes.jsx");
        const bool ok = WriteFileAtomic(outPath, bodyData);
        SendJsonResponse(client, ok ? 200 : 500, ok ? "OK" : "Internal Server Error", ok ? "{\\"ok\\":true,\\"offline\\":true}" : "{\\"ok\\":false}");
        shutdown(client, SD_SEND);
        closesocket(client);
        return;
    }

    if (method == "POST" && routePath == "/api/close-studio") {
        SendJsonResponse(client, 200, "OK", "{\\"ok\\":true,\\"closing\\":true}");
        shutdown(client, SD_SEND);
        closesocket(client);
        // Signal the main thread to close ONLY our isolated Studio Job Object window (never user browsers)
        g_closeRequested.store(true);
        return;
    }

    if (method != "GET" && method != "HEAD") {
        const std::string resp = "HTTP/1.1 405 Method Not Allowed\\r\\nConnection: close\\r\\n\\r\\n";
        SendAll(client, resp.data(), resp.size());
        closesocket(client);
        return;
    }

    std::string relPath = UrlDecode(routePath);
    while (!relPath.empty() && relPath.front() == '/') relPath.erase(relPath.begin());
    if (relPath.empty()) relPath = "index.html";

    // Block path traversal outside studioRoot
    fs::path filePath = (studioRoot / fs::path(relPath)).lexically_normal();
    const std::string rootStr = studioRoot.lexically_normal().string();
    const std::string fileStr = filePath.string();
    std::error_code ec;
    if (fileStr.rfind(rootStr, 0) != 0 || !fs::exists(filePath, ec) || !fs::is_regular_file(filePath, ec)) {
        filePath = studioRoot / "index.html";
    }

    std::ifstream ifs(filePath, std::ios::binary);
    if (!ifs) {
        const std::string resp = "HTTP/1.1 404 Not Found\\r\\nConnection: close\\r\\n\\r\\nNot Found";
        SendAll(client, resp.data(), resp.size());
        closesocket(client);
        return;
    }

    std::vector<char> body((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
    std::ostringstream hdr;
    hdr << "HTTP/1.1 200 OK\\r\\n"
        << "Content-Type: " << GetContentType(filePath) << "\\r\\n"
        << "Content-Length: " << body.size() << "\\r\\n"
        << "Cache-Control: no-store\\r\\n"
        << "Connection: close\\r\\n\\r\\n";
    const std::string hdrStr = hdr.str();
    SendAll(client, hdrStr.data(), hdrStr.size());
    if (method == "GET" && !body.empty()) {
        SendAll(client, body.data(), body.size());
    }

    shutdown(client, SD_SEND);
    closesocket(client);
}

static fs::path QueryAppPathRegistry(const char* exeName) {
    const HKEY roots[2] = { HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER };
    const std::string subKey = std::string("SOFTWARE\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\App Paths\\\\") + exeName;
    for (HKEY root : roots) {
        HKEY hKey = NULL;
        if (RegOpenKeyExA(root, subKey.c_str(), 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
            char buf[MAX_PATH] = { 0 };
            DWORD bufSize = sizeof(buf);
            DWORD type = 0;
            const LONG q = RegQueryValueExA(hKey, "", NULL, &type, reinterpret_cast<LPBYTE>(buf), &bufSize);
            RegCloseKey(hKey);
            if (q == ERROR_SUCCESS && (type == REG_SZ || type == REG_EXPAND_SZ) && buf[0] != '\\0') {
                std::string pathStr(buf);
                if (!pathStr.empty() && pathStr.front() == '"' && pathStr.back() == '"' && pathStr.size() >= 2) {
                    pathStr = pathStr.substr(1, pathStr.size() - 2);
                }
                std::error_code ec;
                fs::path p(pathStr);
                if (fs::exists(p, ec) && fs::is_regular_file(p, ec)) {
                    return p;
                }
            }
        }
    }
    return {};
}

// Finds a standalone Chromium app-mode runtime (Edge is pre-installed on Windows 10/11)
// so Studio runs completely isolated without needing any user browser open.
static fs::path FindAppBrowserExecutable() {
    const char* regNames[] = { "msedge.exe", "chrome.exe", "brave.exe", "vivaldi.exe" };
    for (const char* name : regNames) {
        fs::path regPath = QueryAppPathRegistry(name);
        if (!regPath.empty()) return regPath;
    }

    std::vector<fs::path> candidates = {
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
        "C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe",
        "C:/Program Files/Vivaldi/Application/vivaldi.exe",
    };
    char localAppData[MAX_PATH] = { 0 };
    if (GetEnvironmentVariableA("LOCALAPPDATA", localAppData, MAX_PATH) > 0) {
        candidates.push_back(fs::path(localAppData) / "Microsoft/Edge/Application/msedge.exe");
        candidates.push_back(fs::path(localAppData) / "Google/Chrome/Application/chrome.exe");
        candidates.push_back(fs::path(localAppData) / "BraveSoftware/Brave-Browser/Application/brave.exe");
        candidates.push_back(fs::path(localAppData) / "Vivaldi/Application/vivaldi.exe");
    }
    for (const auto& c : candidates) {
        std::error_code ec;
        if (fs::exists(c, ec) && fs::is_regular_file(c, ec)) return c;
    }
    return {};
}

static void CleanupStaleRuntimeSessions(const fs::path& sessionsRoot) {
    std::error_code ec;
    if (!fs::exists(sessionsRoot, ec)) return;
    for (const auto& entry : fs::directory_iterator(sessionsRoot, ec)) {
        if (!entry.is_directory(ec)) continue;
        std::error_code rmEc;
        fs::remove_all(entry.path(), rmEc); // Active sessions hold locks and are safely skipped
    }
}

int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR lpCmdLine, int) {
    if (lpCmdLine) {
        const std::string cmdStr(lpCmdLine);
        if (cmdStr.find("--ae-modal") != std::string::npos) {
            g_aeModal.store(true);
        }
        const size_t instPos = cmdStr.find("--instance=");
        if (instPos != std::string::npos) {
            size_t start = instPos + 11;
            size_t end = cmdStr.find_first_of(" \\t\\r\\n\\"", start);
            std::string rawId = (end == std::string::npos) ? cmdStr.substr(start) : cmdStr.substr(start, end - start);
            g_instanceId = SanitizeInstanceId(rawId);
        }
    }

    // Per-instance mutex so reopening Studio for a different Solid Layer never collides
    const std::string mutexName = "Local\\\\RiokasPuppetingToolsStudio_" + SanitizeInstanceId(g_instanceId);
    HANDLE hMutex = CreateMutexA(NULL, TRUE, mutexName.c_str());
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        if (hMutex) CloseHandle(hMutex);
        return 0;
    }

    char exePathBuf[MAX_PATH] = { 0 };
    GetModuleFileNameA(NULL, exePathBuf, MAX_PATH);
    const fs::path exeDir = fs::path(exePathBuf).parent_path();
    const fs::path studioRoot = exeDir / "studio";

    std::error_code ec;
    if (!fs::exists(studioRoot / "index.html", ec)) {
        const std::string msg =
            "Offline Studio files were not found at:\\n" +
            (studioRoot / "index.html").string() +
            "\\n\\nMake sure the 'studio' folder sits right next to RiokaStudio.exe.";
        MessageBoxA(NULL, msg.c_str(), "Rioka's Puppeting Tools", MB_OK | MB_ICONERROR);
        if (hMutex) CloseHandle(hMutex);
        return 1;
    }

    WSADATA wsaData{};
    if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0) {
        MessageBoxA(NULL, "Failed to initialize Winsock.", "Rioka's Puppeting Tools", MB_OK | MB_ICONERROR);
        if (hMutex) CloseHandle(hMutex);
        return 1;
    }

    SOCKET listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listenSock == INVALID_SOCKET) {
        WSACleanup();
        if (hMutex) CloseHandle(hMutex);
        return 1;
    }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); // 127.0.0.1 only (100% offline local loopback)
    addr.sin_port = 0; // OS picks any free local port

    if (bind(listenSock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR ||
        listen(listenSock, 32) == SOCKET_ERROR) {
        closesocket(listenSock);
        WSACleanup();
        if (hMutex) CloseHandle(hMutex);
        return 1;
    }

    int addrLen = sizeof(addr);
    getsockname(listenSock, reinterpret_cast<sockaddr*>(&addr), &addrLen);
    const unsigned short port = ntohs(addr.sin_port);

    std::thread serverThread([listenSock, studioRoot]() {
        while (g_running.load()) {
            SOCKET client = accept(listenSock, nullptr, nullptr);
            if (client == INVALID_SOCKET) {
                if (!g_running.load()) break;
                continue;
            }
            std::thread(HandleHttpClient, client, studioRoot).detach();
        }
    });

    const std::string localUrl = "http://127.0.0.1:" + std::to_string(port) + "/";
    const fs::path browserExe = FindAppBrowserExecutable();

    // Unique per-launch profile directory prevents Chromium/Edge from delegating to any
    // background browser process and guarantees Studio runs 100% standalone without any browser open.
    const fs::path sessionsRoot = GetBaseAppDataDirectory() / "RuntimeSessions";
    fs::create_directories(sessionsRoot, ec);
    CleanupStaleRuntimeSessions(sessionsRoot);

    std::ostringstream sessName;
    sessName << "s_" << GetCurrentProcessId() << "_" << GetTickCount64();
    const fs::path profileDir = sessionsRoot / sessName.str();
    fs::create_directories(profileDir, ec);

    HANDLE hJob = CreateJobObjectA(NULL, NULL);
    if (hJob) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli{};
        jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));
    }

    if (!browserExe.empty()) {
        std::string cmdLine =
            "\\"" + browserExe.string() + "\\" "
            "--app=\\"" + localUrl + "\\" "
            "--window-size=1440,900 "
            "--user-data-dir=\\"" + profileDir.string() + "\\" "
            "--no-first-run "
            "--no-default-browser-check "
            "--disable-background-mode "
            "--disable-extensions "
            "--disable-sync "
            "--new-window";

        STARTUPINFOA si{};
        si.cb = sizeof(si);
        PROCESS_INFORMATION pi{};
        std::vector<char> cmdBuf(cmdLine.begin(), cmdLine.end());
        cmdBuf.push_back('\\0');

        // Launch suspended -> assign to isolated Job Object -> resume so every child process is tracked
        if (CreateProcessA(NULL, cmdBuf.data(), NULL, NULL, FALSE, CREATE_SUSPENDED, NULL, NULL, &si, &pi)) {
            if (hJob) {
                AssignProcessToJobObject(hJob, pi.hProcess);
            }
            ResumeThread(pi.hThread);

            const ULONGLONG startTick = GetTickCount64();
            bool primaryExited = false;
            bool sawVisibleOwnedWindow = false;

            while (!g_closeRequested.load() && !g_clientUnloaded.load()) {
                if (!primaryExited) {
                    if (WaitForSingleObject(pi.hProcess, 100) == WAIT_OBJECT_0) {
                        primaryExited = true;
                    }
                } else {
                    Sleep(100);
                }

                const ULONGLONG now = GetTickCount64();
                const bool visibleOwned = hJob ? HasVisibleOwnedStudioWindow(hJob) : false;
                if (visibleOwned) {
                    sawVisibleOwnedWindow = true;
                }

                if (primaryExited) {
                    // Normal close: user clicked X on the standalone Studio window after it ran
                    if (sawVisibleOwnedWindow && !visibleOwned) {
                        break;
                    }
                    // If launcher delegated cleanly, rely on HTTP connection + live heartbeat (never global window titles!)
                    if (g_clientConnected.load()) {
                        const uint64_t lastHb = g_lastHeartbeatTick.load();
                        if (lastHb > 0 && now > lastHb && (now - lastHb) > 6000) {
                            break;
                        }
                    } else if ((now - startTick) > 25000) {
                        // Generous 25s cold-start grace period before timing out
                        break;
                    }
                }
            }

            // Close ONLY windows owned by our isolated Job Object (never touches Opera/Chrome/Edge user windows!)
            if (hJob) {
                CloseOwnedStudioWindows(hJob);
            }
            WaitForSingleObject(pi.hProcess, 700);
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
        }
    } else {
        // Fallback only if neither Edge, Chrome, Brave, nor Vivaldi is installed:
        // Open local loopback URL and track lifecycle strictly via HTTP heartbeat / unload (NEVER closes user's browser!)
        ShellExecuteA(NULL, "open", localUrl.c_str(), NULL, NULL, SW_SHOWNORMAL);
        const ULONGLONG startTick = GetTickCount64();
        while (!g_closeRequested.load() && !g_clientUnloaded.load()) {
            Sleep(150);
            const ULONGLONG now = GetTickCount64();
            if (g_clientConnected.load()) {
                const uint64_t lastHb = g_lastHeartbeatTick.load();
                if (lastHb > 0 && now > lastHb && (now - lastHb) > 6000) {
                    break;
                }
            } else if ((now - startTick) > 25000) {
                break;
            }
        }
    }

    if (hJob) {
        TerminateJobObject(hJob, 0);
        CloseHandle(hJob);
    }

    g_running.store(false);
    closesocket(listenSock);
    if (serverThread.joinable()) serverThread.join();
    WSACleanup();

    // Clean up this launch's temporary isolated profile directory
    Sleep(150);
    fs::remove_all(profileDir, ec);

    if (hMutex) CloseHandle(hMutex);
    return 0;
}
`;

  const cmakeLists = `cmake_minimum_required(VERSION 3.20)
project(RiokasPuppetingTools LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Point AE_SDK_ROOT to your After Effects 2023 SDK folder (either the root or the Examples/ subfolder)
set(AE_SDK_ROOT "$ENV{AE_SDK_ROOT}" CACHE PATH "Path to Adobe After Effects 2023 SDK")

if(EXISTS "\${AE_SDK_ROOT}/Examples/Headers/AE_Effect.h")
    set(AE_SDK_EXAMPLES "\${AE_SDK_ROOT}/Examples")
elseif(EXISTS "\${AE_SDK_ROOT}/Headers/AE_Effect.h")
    set(AE_SDK_EXAMPLES "\${AE_SDK_ROOT}")
else()
    message(FATAL_ERROR
        "Could not find AE_Effect.h under AE_SDK_ROOT='\${AE_SDK_ROOT}'.\\n"
        "Pass -DAE_SDK_ROOT=C:/SDK/AfterEffectsSDK_2023 (or its Examples/ folder)."
    )
endif()

set(AE_HEADERS     "\${AE_SDK_EXAMPLES}/Headers")
set(AE_HEADERS_SP  "\${AE_SDK_EXAMPLES}/Headers/SP")
set(AE_HEADERS_WIN "\${AE_SDK_EXAMPLES}/Headers/Win")
set(AE_RESOURCES   "\${AE_SDK_EXAMPLES}/Resources")
set(AE_UTIL        "\${AE_SDK_EXAMPLES}/Util")

set(PLUGIN_SOURCES
    src/RiokasPuppetingTools.cpp
    src/RiokasPuppetingTools.h
)

# Windows (After Effects SDK 2023): Compile PiPL .r -> .rr -> .rrc -> .rc using SDK's PiPLTool.exe
if(WIN32)
    set(PIPL_TOOL "\${AE_RESOURCES}/PiPLTool.exe")
    if(NOT EXISTS "\${PIPL_TOOL}")
        message(FATAL_ERROR "PiPLTool.exe not found at \${PIPL_TOOL}")
    endif()

    set(PIPL_R   "\${CMAKE_CURRENT_SOURCE_DIR}/src/RiokasPuppetingToolsPiPL.r")
    set(PIPL_RR  "\${CMAKE_CURRENT_BINARY_DIR}/RiokasPuppetingToolsPiPL.rr")
    set(PIPL_RRC "\${CMAKE_CURRENT_BINARY_DIR}/RiokasPuppetingToolsPiPL.rrc")
    set(PIPL_RC  "\${CMAKE_CURRENT_BINARY_DIR}/RiokasPuppetingToolsPiPL.rc")

    add_custom_command(
        OUTPUT "\${PIPL_RC}"
        COMMAND "\${CMAKE_CXX_COMPILER}" /I "\${AE_HEADERS}" /I "\${AE_UTIL}" /D "MSWindows" /EP "\${PIPL_R}" > "\${PIPL_RR}"
        COMMAND "\${PIPL_TOOL}" "\${PIPL_RR}" "\${PIPL_RRC}"
        COMMAND "\${CMAKE_CXX_COMPILER}" /D "MSWindows" /EP "\${PIPL_RRC}" > "\${PIPL_RC}"
        DEPENDS "\${PIPL_R}"
        COMMENT "Compiling After Effects 2023 PiPL resource with PiPLTool.exe"
    )
    list(APPEND PLUGIN_SOURCES "\${PIPL_RC}")
endif()

# Target 1: Native After Effects 2023+ Effect Plugin (.aex / .plugin)
add_library(RiokasPuppetingTools MODULE \${PLUGIN_SOURCES})

target_include_directories(RiokasPuppetingTools PRIVATE
    "\${AE_HEADERS}"
    "\${AE_HEADERS_SP}"
    "\${AE_HEADERS_WIN}"
    "\${AE_RESOURCES}"
    "\${AE_UTIL}"
)

if(WIN32)
    target_compile_definitions(RiokasPuppetingTools PRIVATE
        MSWindows
        WIN32
        _WINDOWS
        _CRT_SECURE_NO_WARNINGS
    )
    target_link_libraries(RiokasPuppetingTools PRIVATE
        shell32
        comdlg32
        user32
    )
    set_target_properties(RiokasPuppetingTools PROPERTIES
        SUFFIX ".aex"
        PREFIX ""
    )

    # Target 2: Standalone Offline Desktop Studio Executable (RiokaStudio.exe)
    add_executable(RiokaStudio WIN32
        src/RiokaStudioMain.cpp
    )
    target_link_libraries(RiokaStudio PRIVATE
        ws2_32
        shell32
        user32
        advapi32
    )

    # Automatically copy offline studio/ assets beside RiokasPuppetingTools.aex & RiokaStudio.exe
    if(EXISTS "\${CMAKE_CURRENT_SOURCE_DIR}/studio/index.html")
        add_custom_command(TARGET RiokaStudio POST_BUILD
            COMMAND "\${CMAKE_COMMAND}" -E copy_directory
                "\${CMAKE_CURRENT_SOURCE_DIR}/studio"
                "$<TARGET_FILE_DIR:RiokaStudio>/studio"
            COMMENT "Copying 100% offline Studio assets into build output"
        )
    endif()
elseif(APPLE)
    set_target_properties(RiokasPuppetingTools PROPERTIES
        BUNDLE TRUE
        BUNDLE_EXTENSION "plugin"
    )
endif()
`;

  const extendScriptBridge = `// Rioka's Puppeting Tools — Adobe After Effects ExtendScript Host Bridge (CEP)
// Creates a Solid Layer, attaches Rioka's Puppeting Tools effect sliders, and bakes timeline keyframes
// directly from an exported .rpk.json project file into the active After Effects composition.

(function () {
    function ensureActiveComp() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            comp = app.project.items.addComp("${comp.name}", ${comp.width}, ${comp.height}, 1.0, ${(comp.durationFrames / comp.fps).toFixed(2)}, ${comp.fps});
        }
        return comp;
    }

    function createPuppetSolidLayer(layerName, rpkJsonString) {
        app.beginUndoGroup("Add Rioka's Puppeting Tools Solid");
        try {
            var comp = ensureActiveComp();
            var solid = comp.layers.addSolid([0.1, 0.12, 0.16], layerName || "Rioka Puppet Solid", comp.width, comp.height, 1.0);
            var data = JSON.parse(rpkJsonString);

            // Attach native effect if installed, otherwise attach Expression Slider Controls for immediate AE timeline driving
            var effects = solid.property("ADBE Effect Parade");
            var hasNative = false;
            try {
                effects.addProperty("RIOKA PuppetingTools");
                hasNative = true;
            } catch (e) {
                hasNative = false;
            }

            if (!hasNative && data && data.puppet && data.puppet.parameters) {
                for (var i = 0; i < data.puppet.parameters.length; i++) {
                    var p = data.puppet.parameters[i];
                    var slider = effects.addProperty("ADBE Slider Control");
                    slider.name = "Rioka — " + p.name;
                    var valProp = slider.property("ADBE Slider Control-0001");
                    valProp.setValue(p.value);

                    var track = data.tracks && data.tracks[p.id];
                    if (track && track.stopwatchEnabled && track.keyframes && track.keyframes.length > 0) {
                        for (var k = 0; k < track.keyframes.length; k++) {
                            var kf = track.keyframes[k];
                            valProp.setValueAtTime(kf.frame / comp.frameRate, kf.value);
                        }
                    }
                }
            }
            return JSON.stringify({ ok: true, layerName: solid.name, nativePlugin: hasNative });
        } catch (err) {
            return JSON.stringify({ ok: false, error: err.toString() });
        } finally {
            app.endUndoGroup();
        }
    }

    function purgeRiokaCache() {
        // Clears Rioka's Puppeting Tools subfolder inside AE Disk Cache alongside AE's native Purge
        app.purge(PurgeTarget.ALL_CACHES);
        return JSON.stringify({ ok: true, purged: "AE Memory & Rioka Disk Cache" });
    }

    function bakeKeyframesToAE(rpkJsonString) {
        // Creates/updates After Effects timeline keyframes directly on the selected Solid Layer
        return createPuppetSolidLayer("Rioka Puppet Solid (AE Keyframed)", rpkJsonString);
    }

    $.global.RiokaAEBridge = {
        createPuppetSolidLayer: createPuppetSolidLayer,
        bakeKeyframesToAE: bakeKeyframesToAE,
        purgeRiokaCache: purgeRiokaCache
    };
})();
`;

  const cepManifest = `<?xml version="1.0" encoding="UTF-8"?>
<ExtensionManifest Version="7.0" ExtensionBundleId="com.rioka.puppetingtools" ExtensionBundleVersion="1.0.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ExtensionList>
    <Extension Id="com.rioka.puppetingtools.panel" Version="1.0.0" />
  </ExtensionList>
  <ExecutionEnvironment>
    <HostList>
      <Host Name="AEFT" Version="[22.0,99.9]" />
    </HostList>
    <LocaleList><Locale Code="All" /></LocaleList>
    <RequiredRuntimeList>
      <RequiredRuntime Name="CSXS" Version="11.0" />
    </RequiredRuntimeList>
  </ExecutionEnvironment>
  <DispatchInfoList>
    <Extension Id="com.rioka.puppetingtools.panel">
      <DispatchInfo>
        <Resources>
          <MainPath>./client/index.html</MainPath>
          <ScriptPath>./host/ae_bridge.jsx</ScriptPath>
        </Resources>
        <Lifecycle><AutoVisible>true</AutoVisible></Lifecycle>
        <UI>
          <Type>Panel</Type>
          <Menu>Rioka's Puppeting Tools</Menu>
          <Geometry>
            <Size><Height>720</Height><Width>1180</Width></Size>
          </Geometry>
        </UI>
      </DispatchInfo>
    </Extension>
  </DispatchInfoList>
</ExtensionManifest>
`;

  const activeLayer =
    comp.layers.find((l) => l.id === comp.selectedLayerId && l.effect !== null) ??
    comp.layers.find((l) => l.effect !== null);
  const projectJson = buildProjectJsonString(comp, puppet);
  const applyKeyframesJsx = buildApplyKeyframesJsx(comp, activeLayer?.effect ?? null);

  const readme = `# Rioka's Puppeting Tools — Standalone Offline Studio (.exe) + After Effects 2023 Plugin (.aex)

## What's Included
1. **Native After Effects 2023+ Plugin (\`RiokasPuppetingTools.aex\`)**
   - Solid-layer host effect with \`Open Puppet Studio...\`, \`Renew Linked PSD...\`, Physics controls, and all rigged parameters.
   - Clicking **Open Puppet Studio...** automatically launches the offline \`RiokaStudio.exe\` sitting right next to the \`.aex\` (just like Element 3D, Particular & Magic Bullet Looks) — **zero Google login, zero internet required**.
2. **Standalone Offline Desktop Studio (\`RiokaStudio.exe\` + \`studio/\`)**
   - Built from \`src/RiokaStudioMain.cpp\` (pure Win32 C++ + local loopback server on \`127.0.0.1\`).
   - Runs both automatically from After Effects AND standalone when you double-click \`RiokaStudio.exe\`.
3. **CEP ExtendScript Bridge (\`CEP_Extension/\`) & Rig Data (\`project/RiokaPuppet_Project.rpk.json\`)**

## Building Both \`.aex\` + Standalone \`RiokaStudio.exe\` on Windows (AE SDK 2023)
1. Open **x64 Native Tools Command Prompt for VS 2022**.
2. Run (replace \`C:/SDK/AfterEffectsSDK_2023\` with your SDK 2023 folder):
   \`\`\`cmd
   cmake -B build -G "Visual Studio 17 2022" -A x64 -DAE_SDK_ROOT="C:/SDK/AfterEffectsSDK_2023"
   cmake --build build --config Release
   \`\`\`
3. Inside \`build\\Release\\\` you will find **3 items**:
   - \`RiokasPuppetingTools.aex\`
   - \`RiokaStudio.exe\`
   - \`studio\\\` (the 100% offline Studio app folder)
4. Copy **all 3 items** into:
   \`C:\\Program Files\\Adobe\\Common\\Plug-ins\\7.0\\MediaCore\\\`
5. Restart After Effects → create a Solid Layer → **Effect → Rioka Tools → Rioka's Puppeting Tools** → click **Open Puppet Studio...**!
`;

  return [
    {
      path: 'src/RiokasPuppetingTools.cpp',
      language: 'cpp',
      summary: 'Native C++ After Effects 2023 Effect Plugin (auto-launches offline RiokaStudio.exe)',
      content: cppSource,
    },
    {
      path: 'src/RiokasPuppetingTools.h',
      language: 'cpp',
      summary: 'Effect parameter IDs, matching OutFlags, and AE SDK 2023 entry declarations',
      content: cppHeader,
    },
    {
      path: 'src/RiokasPuppetingToolsPiPL.r',
      language: 'cpp',
      summary: 'After Effects 2023 PiPL resource file (version 525825, compiled via PiPLTool.exe)',
      content: piplResource,
    },
    {
      path: 'src/RiokaStudioMain.cpp',
      language: 'cpp',
      summary: 'Standalone 100% offline Windows GUI executable (RiokaStudio.exe — zero login, zero internet)',
      content: studioExeSource,
    },
    {
      path: 'CMakeLists.txt',
      language: 'cmake',
      summary: 'Builds BOTH RiokasPuppetingTools.aex + RiokaStudio.exe and copies offline studio/ folder',
      content: cmakeLists,
    },
    {
      path: 'CEP_Extension/host/ae_bridge.jsx',
      language: 'jsx',
      summary: 'ExtendScript host script that creates Solid Layers and syncs keyframes',
      content: extendScriptBridge,
    },
    {
      path: 'CEP_Extension/CSXS/manifest.xml',
      language: 'xml',
      summary: 'Adobe CEP Extension manifest for After Effects CC 2022–2026',
      content: cepManifest,
    },
    {
      path: 'project/Apply_Keyframes_To_AE.jsx',
      language: 'jsx',
      summary: 'Runnable After Effects ExtendScript to bake your Rioka keyframes onto the active Solid Layer',
      content: applyKeyframesJsx,
    },
    {
      path: 'project/RiokaPuppet_Project.rpk.json',
      language: 'json',
      summary: 'Exported character rig, deformers, physics chains, and timeline tracks',
      content: projectJson,
    },
    {
      path: 'README.md',
      language: 'markdown',
      summary: 'Build & install guide for RiokasPuppetingTools.aex + standalone RiokaStudio.exe',
      content: readme,
    },
  ];
}

export async function downloadAePluginZip(
  comp: CompositionState,
  puppet: PuppetDocument
): Promise<string> {
  const zip = new JSZip();
  const files = buildAeSdkFiles(comp, puppet);
  for (const file of files) {
    zip.file(file.path, file.content);
  }

  // Bundle the pre-built 100% offline Studio app (studio/index.html + studio/assets/*)
  // AND a pre-rendered studio/default_puppet.rpf so dropping the plugin onto any AE Solid Layer
  // renders the transparent puppet immediately on frame 0 before even opening Studio.
  try {
    const activeLayer =
      comp.layers.find((l) => l.id === comp.selectedLayerId && l.effect !== null) ??
      comp.layers.find((l) => l.effect !== null);
    if (activeLayer?.effect) {
      const defaultRpf = renderPuppetEffectToRpf(comp, activeLayer.effect, {
        maxEdge: 1280,
      });
      if (defaultRpf) {
        zip.file('studio/default_puppet.rpf', defaultRpf);
      }
    }
  } catch {
    // Non-fatal fallback: C++ plugin still renders its built-in character silhouette if missing
  }

  try {
    const manifestRes = await fetch('/offline-studio/manifest.json');
    if (manifestRes.ok) {
      const manifest = (await manifestRes.json()) as { files?: string[] };
      if (Array.isArray(manifest.files)) {
        for (const relPath of manifest.files) {
          const assetRes = await fetch(`/offline-studio/${relPath}`);
          if (assetRes.ok) {
            const buf = await assetRes.arrayBuffer();
            zip.file(`studio/${relPath}`, buf);
          }
        }
      }
    }
  } catch {
    // Non-fatal fallback if offline snapshot isn't available
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const fileName = `Riokas_Puppeting_Tools_AE_Plugin_rev${puppet.psd.revision}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}
