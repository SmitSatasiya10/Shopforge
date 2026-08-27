"use client";

import type { LucideIcon } from "lucide-react";
import { Images, LayoutGrid, Sparkles } from "lucide-react";

interface RailTool {
  id: "sections" | "ai" | "media";
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}

interface EditorRailProps {
  sectionsActive: boolean;
  aiActive: boolean;
  mediaActive: boolean;
  onSections: () => void;
  onAI: () => void;
  onMedia: () => void;
}

/**
 * The editor's left tool rail — Sections / AI / Media. Each button just toggles whichever
 * overlay already implements that workflow (SectionPicker, the inline AI panel, MediaPanel);
 * this component only renders the rail and reflects which one is currently open.
 */
export function EditorRail({ sectionsActive, aiActive, mediaActive, onSections, onAI, onMedia }: EditorRailProps) {
  const tools: RailTool[] = [
    { id: "sections", label: "Sections", icon: LayoutGrid, active: sectionsActive, onClick: onSections },
    { id: "ai", label: "AI", icon: Sparkles, active: aiActive, onClick: onAI },
    { id: "media", label: "Media", icon: Images, active: mediaActive, onClick: onMedia },
  ];

  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-neutral-800 bg-neutral-900 pt-3">
      {tools.map(({ id, label, icon: Icon, active, onClick }) => (
        <button
          key={id}
          onClick={onClick}
          title={label}
          aria-pressed={active}
          className={`flex w-11 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium ${
            active ? "bg-white text-neutral-900" : "text-neutral-400 hover:bg-white/10 hover:text-white"
          }`}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </div>
  );
}
