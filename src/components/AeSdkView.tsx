import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  Save,
} from 'lucide-react';
import type { CompositionState, PuppetDocument } from '../types/puppet';
import { buildAeSdkFiles, downloadAePluginZip } from '../engine/aeSdkGenerator';

interface AeSdkViewProps {
  composition: CompositionState;
  puppet: PuppetDocument;
  onImportProjectJson: (jsonText: string) => void;
}

export function AeSdkView({
  composition,
  puppet,
  onImportProjectJson,
}: AeSdkViewProps) {
  const files = useMemo(
    () => buildAeSdkFiles(composition, puppet),
    [composition, puppet]
  );
  const [selectedPath, setSelectedPath] = useState<string>(files[0].path);
  const [copied, setCopied] = useState(false);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const activeFile =
    files.find((f) => f.path === selectedPath) ?? files[0];

  const handleDownloadZip = async () => {
    const zipName = await downloadAePluginZip(composition, puppet);
    setDownloadNote(`Exported ${zipName}`);
    setTimeout(() => setDownloadNote(null), 4000);
  };

  const handleDownloadProjectJson = () => {
    const projectEntry = files.find((f) => f.path.endsWith('.rpk.json'));
    if (!projectEntry) return;
    const blob = new Blob([projectEntry.content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RiokaPuppet_Rev${puppet.psd.revision}.rpk.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloadNote('Saved .rpk.json project file');
    setTimeout(() => setDownloadNote(null), 3500);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#1D1D1D]">
      {/* Header Summary Strip */}
      <div className="px-6 py-4 border-b border-[#383838] bg-[#232323] flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-[16px] font-semibold text-[#F0F0F0]">
            Standalone Offline Studio (.exe) &amp; After Effects Plugin (.aex)
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#A0A0A0] tabular-nums">
            <span className="text-[#93C5FD] font-medium">
              100% Offline · Zero Google Login
            </span>
            <span aria-hidden="true">·</span>
            <span>{puppet.psd.fileName} (Rev {puppet.psd.revision})</span>
            <span aria-hidden="true">·</span>
            <span>{puppet.layers.length} ArtMesh layers</span>
            <span aria-hidden="true">·</span>
            <span>{puppet.keyforms.length} keyforms</span>
            <span aria-hidden="true">·</span>
            <span>{puppet.physicsGroups.length} physics chains</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <input
            ref={importRef}
            type="file"
            accept=".json,.rpk.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              file.text().then((txt) => onImportProjectJson(txt));
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="px-3 py-2 rounded-md bg-[#2E2E2E] hover:bg-[#3A3A3A] border border-[#444444] text-[12px] font-medium text-[#ECECEC] flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Load .rpk.json
          </button>
          <button
            type="button"
            onClick={handleDownloadProjectJson}
            className="px-3 py-2 rounded-md bg-[#2E2E2E] hover:bg-[#3A3A3A] border border-[#444444] text-[12px] font-medium text-[#ECECEC] flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            Save Project
          </button>
          <button
            type="button"
            onClick={handleDownloadZip}
            className="px-4 py-2 rounded-md bg-[#2D8CEB] hover:bg-[#1E7AD6] text-white text-[12px] font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Download AE Plugin Bundle (.zip)
          </button>
        </div>
      </div>

      {downloadNote && (
        <div
          role="status"
          className="px-6 py-2 bg-[#1D2B44] border-b border-[#2E4570] text-[12px] text-[#BFDBFE]"
        >
          {downloadNote}
        </div>
      )}

      {/* Two-Column Source Inspector */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left File Tree */}
        <aside
          aria-label="Plugin bundle files"
          className="w-[310px] shrink-0 bg-[#232323] border-r border-[#383838] overflow-y-auto divide-y divide-[#2F2F2F]"
        >
          {files.map((file) => {
            const isSel = file.path === activeFile.path;
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  isSel
                    ? 'bg-[#2D8CEB]/22 text-[#F3F6FA]'
                    : 'text-[#D4D4D4] hover:bg-[#2B2B2B]'
                }`}
              >
                <div className="flex items-center gap-2 text-[12px] font-mono font-medium">
                  <FileCode2 className="w-3.5 h-3.5 shrink-0 text-[#2D8CEB]" />
                  <span className="truncate">{file.path}</span>
                </div>
                <p className="mt-1 text-[11px] text-[#9E9E9E] leading-snug">
                  {file.summary}
                </p>
              </button>
            );
          })}
        </aside>

        {/* Right Code Viewer */}
        <section
          aria-label="Source code preview"
          className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#181818]"
        >
          <div className="h-10 shrink-0 px-4 border-b border-[#383838] bg-[#232323] flex items-center justify-between">
            <span className="font-mono text-[12px] text-[#ECECEC]">
              {activeFile.path}
            </span>
            <button
              type="button"
              onClick={handleCopyCode}
              className="px-2.5 py-1 rounded bg-[#2E2E2E] hover:bg-[#3A3A3A] text-[11px] font-medium text-[#ECECEC] flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-[#4ADE80]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copy Source
                </>
              )}
            </button>
          </div>
          <pre className="flex-1 overflow-auto p-5 text-[12px] leading-relaxed font-mono text-[#D6DCE8] select-text">
            <code>{activeFile.content}</code>
          </pre>
        </section>
      </div>
    </div>
  );
}
