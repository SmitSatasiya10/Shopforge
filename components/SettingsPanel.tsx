"use client";

import { SectionDefinition } from "@/lib/store-config/types";

interface SettingsPanelProps {
  definition: SectionDefinition | null;
  values: Record<string, string | boolean>;
  onChange: (settingId: string, value: string | boolean) => void;
  onClose: () => void;
}

export function SettingsPanel({ definition, values, onChange, onClose }: SettingsPanelProps) {
  if (!definition) {
    return (
      <aside className="w-80 shrink-0 border-l border-neutral-200 p-4 text-sm text-neutral-500">
        Click a section in the preview to edit its settings.
      </aside>
    );
  }

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-200 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">{definition.name}</h2>
        <button onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-900">
          Close
        </button>
      </div>
      <div className="flex flex-col gap-4">
        {definition.settings.map((setting) => {
          const value = values[setting.id] ?? setting.default ?? "";
          return (
            <label key={setting.id} className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
              {setting.label}
              {setting.type === "richtext" || setting.type === "textarea" ? (
                <textarea
                  className="rounded border border-neutral-300 p-2 text-sm font-normal"
                  rows={4}
                  value={String(value)}
                  onChange={(e) => onChange(setting.id, e.target.value)}
                />
              ) : setting.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(e) => onChange(setting.id, e.target.checked)}
                />
              ) : (
                <input
                  type={setting.type === "url" || setting.type === "image_picker" ? "url" : "text"}
                  className="rounded border border-neutral-300 p-2 text-sm font-normal"
                  value={String(value)}
                  onChange={(e) => onChange(setting.id, e.target.value)}
                />
              )}
            </label>
          );
        })}
      </div>
    </aside>
  );
}
