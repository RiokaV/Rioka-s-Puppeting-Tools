import { useState } from 'react';
import { Activity, Eye, GitBranch, Plus, Trash2, Wind, Zap } from 'lucide-react';
import type {
  PhysicsGroup,
  PuppetDocument,
  RiokaPuppetEffect,
} from '../types/puppet';

interface PhysicsPanelContentProps {
  puppet: PuppetDocument;
  effect: RiokaPuppetEffect;
  selectedPhysicsGroupId: string;
  showPhysicsOverlay: boolean;
  showPendulumViewer: boolean;
  showParamPhysicsPreview: boolean;
  physicsParamOffsets: Record<string, number>;
  onSelectGroup: (groupId: string) => void;
  onToggleShowOverlay: () => void;
  onTogglePendulumViewer: () => void;
  onToggleParamPhysicsPreview: () => void;
  onTriggerImpulse: () => void;
  onChangeGlobalPhysics: (
    patch: Partial<
      Pick<
        RiokaPuppetEffect,
        'physicsEnabled' | 'physicsStrength' | 'windStrength' | 'windTurbulence'
      >
    >
  ) => void;
  onUpdateGroup: (
    groupId: string,
    updater: (g: PhysicsGroup) => PhysicsGroup
  ) => void;
  onAddPhysicsGroup: () => void;
}

export function PhysicsPanelContent({
  puppet,
  effect,
  selectedPhysicsGroupId,
  showPhysicsOverlay,
  showPendulumViewer,
  showParamPhysicsPreview,
  physicsParamOffsets,
  onSelectGroup,
  onToggleShowOverlay,
  onTogglePendulumViewer,
  onToggleParamPhysicsPreview,
  onTriggerImpulse,
  onChangeGlobalPhysics,
  onUpdateGroup,
  onAddPhysicsGroup,
}: PhysicsPanelContentProps) {
  const [section, setSection] = useState<'tuning' | 'io'>('tuning');

  const activeGroup =
    puppet.physicsGroups.find((g) => g.id === selectedPhysicsGroupId) ??
    puppet.physicsGroups[0];

  return (
    <div className="flex-1 flex flex-col min-h-0 text-[11px]">
      {/* Global Physics Bar */}
      <div className="p-2.5 border-b border-[#363636] bg-[#212121] space-y-2">
        <div className="flex items-center justify-between gap-1.5">
          <label className="flex items-center gap-1.5 text-[#E5E5E5] font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={effect.physicsEnabled}
              onChange={(e) =>
                onChangeGlobalPhysics({ physicsEnabled: e.target.checked })
              }
              className="accent-[#2D8CEB]"
            />
            Live Physics
          </label>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onToggleShowOverlay}
              aria-pressed={showPhysicsOverlay}
              title="Show pendulum guides on canvas"
              className={`px-1.5 py-1 rounded border text-[10px] flex items-center gap-1 transition-colors ${
                showPhysicsOverlay
                  ? 'bg-[#2D8CEB] border-[#4CA0F4] text-white'
                  : 'bg-[#2D2D2D] border-[#424242] text-[#C8C8C8] hover:bg-[#383838]'
              }`}
            >
              <Eye className="w-3 h-3" />
              Chains
            </button>
            <button
              type="button"
              onClick={onTriggerImpulse}
              className="px-2 py-1 rounded bg-[#D97706] hover:bg-[#B45309] text-white text-[10px] font-semibold flex items-center gap-1 transition-colors whitespace-nowrap"
            >
              <Zap className="w-3 h-3" />
              Shake
            </button>
          </div>
        </div>

        {/* Quick Physics Demo Viewers: Pendulum Viewer + Parameter Physics Preview */}
        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
          <button
            type="button"
            disabled={!activeGroup}
            onClick={onTogglePendulumViewer}
            aria-pressed={showPendulumViewer}
            title={
              activeGroup
                ? 'Open Pendulum Viewer to demo physics without modifying original parameters'
                : 'Add a physics group first to preview pendulums'
            }
            className={`px-2 py-1 rounded border text-[10px] font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap disabled:opacity-40 ${
              showPendulumViewer
                ? 'bg-[#2D8CEB] border-[#52A3F5] text-white'
                : 'bg-[#2B2B2B] border-[#424242] text-[#DCDCDC] hover:bg-[#363636]'
            }`}
          >
            <GitBranch className="w-3 h-3 shrink-0" />
            Pendulum Viewer
          </button>
          <button
            type="button"
            onClick={onToggleParamPhysicsPreview}
            aria-pressed={showParamPhysicsPreview}
            title="Show live secondary physics parameters wiggling when you move main parameters"
            className={`px-2 py-1 rounded border text-[10px] font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
              showParamPhysicsPreview
                ? 'bg-[#22C55E] border-[#4ADE80] text-[#0D1A12] font-semibold'
                : 'bg-[#2B2B2B] border-[#424242] text-[#DCDCDC] hover:bg-[#363636]'
            }`}
          >
            <Activity className="w-3 h-3 shrink-0" />
            Param Preview
          </button>
        </div>

        {/* Global Strength & Wind */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="flex justify-between text-[10px] text-[#A0A0A0]">
              <span>Strength</span>
              <span className="font-mono tabular-nums text-[#E5E5E5]">
                {Math.round(effect.physicsStrength * 100)}%
              </span>
            </div>
            <input
              type="range"
              aria-label="Global physics strength"
              min={0}
              max={2}
              step={0.05}
              value={effect.physicsStrength}
              onChange={(e) =>
                onChangeGlobalPhysics({
                  physicsStrength: parseFloat(e.target.value),
                })
              }
              className="w-full studio-slider"
            />
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-[#A0A0A0]">
              <span className="flex items-center gap-1">
                <Wind className="w-2.5 h-2.5 text-[#38BDF8]" />
                Wind
              </span>
              <span className="font-mono tabular-nums text-[#E5E5E5]">
                {effect.windStrength.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              aria-label="Wind strength"
              min={-2}
              max={2}
              step={0.05}
              value={effect.windStrength}
              onChange={(e) =>
                onChangeGlobalPhysics({
                  windStrength: parseFloat(e.target.value),
                })
              }
              className="w-full studio-slider"
            />
          </div>
        </div>
      </div>

      {/* Group Selector + Add Group */}
      <div className="px-2.5 py-1.5 border-b border-[#363636] bg-[#242424] flex items-center gap-1.5">
        <select
          aria-label="Select physics group"
          value={activeGroup?.id ?? ''}
          onChange={(e) => onSelectGroup(e.target.value)}
          className="flex-1 px-2 py-1 rounded bg-[#181818] border border-[#424242] text-[11px] text-[#ECECEC]"
        >
          {puppet.physicsGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.pendulums.length} links)
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onAddPhysicsGroup}
          aria-label="Add physics group"
          title="Add new Cubism physics group"
          className="p-1.5 rounded bg-[#323232] hover:bg-[#3F3F3F] border border-[#454545] text-[#ECECEC]"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Sub-tabs: Pendulum & Delay vs Param 1 -> Param 2/3 Links */}
      <div className="grid grid-cols-2 border-b border-[#363636] bg-[#202020] text-[10px] font-semibold">
        <button
          type="button"
          onClick={() => setSection('tuning')}
          className={`py-1.5 transition-colors ${
            section === 'tuning'
              ? 'text-white border-b-2 border-[#2D8CEB] bg-[#272727]'
              : 'text-[#9A9A9A] hover:text-[#DCDCDC]'
          }`}
        >
          Pendulum &amp; Delay
        </button>
        <button
          type="button"
          onClick={() => setSection('io')}
          className={`py-1.5 transition-colors ${
            section === 'io'
              ? 'text-white border-b-2 border-[#2D8CEB] bg-[#272727]'
              : 'text-[#9A9A9A] hover:text-[#DCDCDC]'
          }`}
        >
          Input → Output Params
        </button>
      </div>

      {/* Active Group Inspector */}
      {!activeGroup && (
        <div className="flex-1 px-4 py-6 flex flex-col items-center justify-center text-center gap-2">
          <p className="text-[11px] font-medium text-[#DCDCDC]">
            No physics groups yet
          </p>
          <p className="text-[10px] text-[#8E939E] max-w-[200px]">
            Add a physics group to simulate hair, ribbon, or cloth motion on your custom parameters.
          </p>
          <button
            type="button"
            onClick={onAddPhysicsGroup}
            className="mt-1 px-2.5 py-1 rounded bg-[#2D8CEB] hover:bg-[#1E7AD6] text-white text-[10px] font-medium flex items-center gap-1 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add Physics Group
          </button>
        </div>
      )}
      {activeGroup && (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
          {section === 'tuning' ? (
            <>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[#E5E5E5] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activeGroup.enabled}
                    onChange={(e) =>
                      onUpdateGroup(activeGroup.id, (g) => ({
                        ...g,
                        enabled: e.target.checked,
                      }))
                    }
                    className="accent-[#2D8CEB]"
                  />
                  Group Enabled
                </label>
                <span className="font-mono text-[10px] text-[#8F8F8F]">
                  Gravity ({activeGroup.gravityX.toFixed(1)},{' '}
                  {activeGroup.gravityY.toFixed(1)})
                </span>
              </div>

              {/* Reaction Delay */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-[#B8B8B8]">Reaction Delay</span>
                  <span className="font-mono tabular-nums text-[#E8E8E8]">
                    {Math.round((activeGroup.delay ?? 0.25) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Physics reaction delay"
                  min={0}
                  max={0.95}
                  step={0.05}
                  value={activeGroup.delay ?? 0.25}
                  onChange={(e) =>
                    onUpdateGroup(activeGroup.id, (g) => ({
                      ...g,
                      delay: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full studio-slider"
                />
              </div>

              {/* Wind Sensitivity */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-[#B8B8B8]">Wind Sensitivity</span>
                  <span className="font-mono tabular-nums text-[#E8E8E8]">
                    {activeGroup.windScale.toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Group wind sensitivity"
                  min={0}
                  max={2.5}
                  step={0.05}
                  value={activeGroup.windScale}
                  onChange={(e) =>
                    onUpdateGroup(activeGroup.id, (g) => ({
                      ...g,
                      windScale: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full studio-slider"
                />
              </div>

              {/* Pendulum Links */}
              <div className="space-y-2 pt-1 border-t border-[#343434]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9A9A9A]">
                    Pendulum Links ({activeGroup.pendulums.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateGroup(activeGroup.id, (g) => ({
                        ...g,
                        pendulums: [
                          ...g.pendulums,
                          { length: 70, damping: 0.86, stiffness: 16, mass: 0.85 },
                        ],
                      }))
                    }
                    className="px-1.5 py-0.5 rounded bg-[#323232] hover:bg-[#3F3F3F] text-[10px] text-[#E5E5E5] flex items-center gap-1"
                  >
                    <Plus className="w-2.5 h-2.5" />
                    Link
                  </button>
                </div>

                {activeGroup.pendulums.map((link, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded bg-[#1E1E1E] border border-[#343434] space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[10px] text-[#CCCCCC]">
                      <span className="font-semibold">Link #{idx + 1}</span>
                      {activeGroup.pendulums.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove pendulum link ${idx + 1}`}
                          onClick={() =>
                            onUpdateGroup(activeGroup.id, (g) => ({
                              ...g,
                              pendulums: g.pendulums.filter((_, i) => i !== idx),
                            }))
                          }
                          className="text-[#8E8E8E] hover:text-[#F87171]"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="flex justify-between text-[9px] text-[#9A9A9A]">
                          <span>Length</span>
                          <span className="font-mono">{link.length}px</span>
                        </div>
                        <input
                          type="range"
                          min={25}
                          max={150}
                          step={5}
                          value={link.length}
                          onChange={(e) =>
                            onUpdateGroup(activeGroup.id, (g) => ({
                              ...g,
                              pendulums: g.pendulums.map((p, i) =>
                                i === idx
                                  ? { ...p, length: parseInt(e.target.value, 10) }
                                  : p
                              ),
                            }))
                          }
                          className="w-full studio-slider"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[9px] text-[#9A9A9A]">
                          <span>Stiffness</span>
                          <span className="font-mono">{link.stiffness}</span>
                        </div>
                        <input
                          type="range"
                          min={5}
                          max={40}
                          step={1}
                          value={link.stiffness}
                          onChange={(e) =>
                            onUpdateGroup(activeGroup.id, (g) => ({
                              ...g,
                              pendulums: g.pendulums.map((p, i) =>
                                i === idx
                                  ? { ...p, stiffness: parseInt(e.target.value, 10) }
                                  : p
                              ),
                            }))
                          }
                          className="w-full studio-slider"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[9px] text-[#9A9A9A]">
                          <span>Damping</span>
                          <span className="font-mono">
                            {link.damping.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={0.96}
                          step={0.02}
                          value={link.damping}
                          onChange={(e) =>
                            onUpdateGroup(activeGroup.id, (g) => ({
                              ...g,
                              pendulums: g.pendulums.map((p, i) =>
                                i === idx
                                  ? { ...p, damping: parseFloat(e.target.value) }
                                  : p
                              ),
                            }))
                          }
                          className="w-full studio-slider"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[9px] text-[#9A9A9A]">
                          <span>Mass</span>
                          <span className="font-mono">
                            {link.mass.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.3}
                          max={2.2}
                          step={0.05}
                          value={link.mass}
                          onChange={(e) =>
                            onUpdateGroup(activeGroup.id, (g) => ({
                              ...g,
                              pendulums: g.pendulums.map((p, i) =>
                                i === idx
                                  ? { ...p, mass: parseFloat(e.target.value) }
                                  : p
                              ),
                            }))
                          }
                          className="w-full studio-slider"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Cubism Param 1 -> Param 2 & 3 Link Editor */
            <div className="space-y-3">
              {/* Inputs */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9A9A9A]">
                    Input Drivers (Param 1)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateGroup(activeGroup.id, (g) => ({
                        ...g,
                        inputs: [
                          ...g.inputs,
                          {
                            parameterId: puppet.parameters[0]?.id ?? 'ParamAngleX',
                            type: 'positionX',
                            weight: 1,
                            scale: 1.5,
                          },
                        ],
                      }))
                    }
                    className="px-1.5 py-0.5 rounded bg-[#323232] hover:bg-[#3F3F3F] text-[10px] text-[#E5E5E5] flex items-center gap-0.5"
                  >
                    <Plus className="w-2.5 h-2.5" />
                    Input
                  </button>
                </div>

                {activeGroup.inputs.map((inp, idx) => (
                  <div
                    key={idx}
                    className="p-1.5 rounded bg-[#1E1E1E] border border-[#343434] flex items-center gap-1.5"
                  >
                    <select
                      aria-label={`Input parameter ${idx + 1}`}
                      value={inp.parameterId}
                      onChange={(e) =>
                        onUpdateGroup(activeGroup.id, (g) => ({
                          ...g,
                          inputs: g.inputs.map((item, i) =>
                            i === idx
                              ? { ...item, parameterId: e.target.value }
                              : item
                          ),
                        }))
                      }
                      className="flex-1 px-1.5 py-0.5 rounded bg-[#141414] border border-[#3D3D3D] text-[10px] text-[#ECECEC]"
                    >
                      {puppet.parameters.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Input axis ${idx + 1}`}
                      value={inp.type}
                      onChange={(e) =>
                        onUpdateGroup(activeGroup.id, (g) => ({
                          ...g,
                          inputs: g.inputs.map((item, i) =>
                            i === idx
                              ? {
                                  ...item,
                                  type: e.target.value as
                                    | 'positionX'
                                    | 'positionY'
                                    | 'angle',
                                }
                              : item
                          ),
                        }))
                      }
                      className="w-[66px] px-1 py-0.5 rounded bg-[#141414] border border-[#3D3D3D] text-[10px] text-[#CCCCCC]"
                    >
                      <option value="positionX">Pos X</option>
                      <option value="positionY">Pos Y</option>
                      <option value="angle">Angle</option>
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove input ${idx + 1}`}
                      onClick={() =>
                        onUpdateGroup(activeGroup.id, (g) => ({
                          ...g,
                          inputs: g.inputs.filter((_, i) => i !== idx),
                        }))
                      }
                      className="text-[#888888] hover:text-[#F87171]"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Outputs (Drives Secondary Parameters & Deformers) */}
              <div className="space-y-1.5 pt-2 border-t border-[#343434]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9A9A9A]">
                    Driven Outputs (Param 2 &amp; 3)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateGroup(activeGroup.id, (g) => ({
                        ...g,
                        outputs: [
                          ...g.outputs,
                          {
                            targetType: 'parameter',
                            targetId:
                              puppet.parameters.find((p) => p.group === 'Physics')
                                ?.id ??
                              puppet.parameters[0]?.id ??
                              'ParamHairFrontSway',
                            property: 'paramValue',
                            pendulumIndex: Math.max(0, g.pendulums.length - 1),
                            scale: 0.85,
                          },
                        ],
                      }))
                    }
                    className="px-1.5 py-0.5 rounded bg-[#2D8CEB] hover:bg-[#1E7AD6] text-[10px] text-white flex items-center gap-0.5"
                  >
                    <Plus className="w-2.5 h-2.5" />
                    Output Param
                  </button>
                </div>

                {activeGroup.outputs.map((out, idx) => {
                  const isParamOut = out.targetType === 'parameter';
                  const liveDelta = isParamOut
                    ? (physicsParamOffsets[out.targetId] ?? 0)
                    : 0;
                  return (
                    <div
                      key={idx}
                      className="p-2 rounded bg-[#1E1E1E] border border-[#343434] space-y-1.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                            isParamOut
                              ? 'bg-[#2D8CEB]/25 text-[#60A5FA]'
                              : 'bg-[#363636] text-[#B8B8B8]'
                          }`}
                        >
                          {isParamOut ? 'Param' : 'Deformer'}
                        </span>
                        {isParamOut ? (
                          <select
                            aria-label={`Output parameter ${idx + 1}`}
                            value={out.targetId}
                            onChange={(e) =>
                              onUpdateGroup(activeGroup.id, (g) => ({
                                ...g,
                                outputs: g.outputs.map((item, i) =>
                                  i === idx
                                    ? { ...item, targetId: e.target.value }
                                    : item
                                ),
                              }))
                            }
                            className="flex-1 px-1.5 py-0.5 rounded bg-[#141414] border border-[#3D3D3D] text-[10px] text-[#ECECEC]"
                          >
                            {puppet.parameters.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="flex-1 text-[10px] text-[#DCDCDC] truncate">
                            {puppet.deformers.find((d) => d.id === out.targetId)
                              ?.name ?? out.targetId}{' '}
                            ({out.property})
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove output ${idx + 1}`}
                          onClick={() =>
                            onUpdateGroup(activeGroup.id, (g) => ({
                              ...g,
                              outputs: g.outputs.filter((_, i) => i !== idx),
                            }))
                          }
                          className="text-[#888888] hover:text-[#F87171]"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[9px] text-[#A0A0A0]">
                        <span>Scale: {out.scale.toFixed(2)}×</span>
                        <input
                          type="range"
                          aria-label={`Output scale ${idx + 1}`}
                          min={-2}
                          max={2}
                          step={0.05}
                          value={out.scale}
                          onChange={(e) =>
                            onUpdateGroup(activeGroup.id, (g) => ({
                              ...g,
                              outputs: g.outputs.map((item, i) =>
                                i === idx
                                  ? {
                                      ...item,
                                      scale: parseFloat(e.target.value),
                                    }
                                  : item
                              ),
                            }))
                          }
                          className="flex-1 studio-slider"
                        />
                        {isParamOut && (
                          <span className="font-mono tabular-nums text-[#38BDF8] w-9 text-right">
                            {liveDelta >= 0 ? '+' : ''}
                            {liveDelta.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
