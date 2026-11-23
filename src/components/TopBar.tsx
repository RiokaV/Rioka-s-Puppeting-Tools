import type { WorkspaceView } from '../types/puppet';

interface TopBarProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  onPrimaryAction: () => void;
  primaryActionLabel: string;
}

const NAV_ITEMS: Array<{ id: WorkspaceView; label: string }> = [
  { id: 'plugin_window', label: 'Rioka Puppeting Tools' },
  { id: 'ae_sdk', label: 'AE Plugin SDK' },
];

export function TopBar({
  activeView,
  onSelectView,
  onPrimaryAction,
  primaryActionLabel,
}: TopBarProps) {
  return (
    <header className="h-11 shrink-0 flex items-center justify-between gap-8 px-4 bg-[#232323] border-b border-[#3A3A3A]">
      <div className="text-[14px] font-semibold tracking-tight text-[#F0F0F0] whitespace-nowrap shrink-0">
        Rioka&apos;s Puppeting Tools
      </div>

      <nav
        aria-label="Workspace views"
        className="flex items-center gap-6 h-full"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative h-full px-1 text-[12px] font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:text-white ${
                isActive
                  ? 'text-[#F0F0F0]'
                  : 'text-[#A0A0A0] hover:text-[#E5E5E5]'
              }`}
            >
              {item.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-[#2D8CEB]"
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onPrimaryAction}
          className="px-3.5 py-1.5 text-[12px] font-semibold text-white bg-[#2D8CEB] hover:bg-[#1E7AD6] rounded-[5px] transition-colors whitespace-nowrap shrink-0"
        >
          {primaryActionLabel}
        </button>
      </div>
    </header>
  );
}
