import type { StoreConfiguration } from "@/lib/store-config/store";

const COLORS_CHANGER_TYPE = "colors-changer";

/**
 * "Store colors changer" sections (public/base-theme/sections/colors-changer.liquid) declare
 * their own copy of every global color setting and render a page-scoped `:root` override — a
 * real feature, by the section's own schema copy ("change your global store colors on THIS
 * PAGE ONLY"). But every default template seeds one preloaded with the theme's stock defaults,
 * which do nothing until a Design panel color changes — at which point those frozen defaults
 * silently outrank the new global value in the CSS cascade (the section's `<style>` renders
 * later in the document than the layout's own `:root` block) on any page that carries one, product
 * pages included. The homepage has no such section, which is why a Design panel edit already
 * "just works" there.
 *
 * Keeping a colors-changer instance's matching settings mirrored to whatever the Design panel
 * just set is what makes that edit apply everywhere by default, the same way it already does on
 * a page with no colors-changer section — while a merchant who deliberately edits that section's
 * own controls afterward still lands exactly where SettingsPanel already lets them.
 */
export function syncColorsChangerSections(
  configuration: StoreConfiguration,
  patch: Record<string, unknown>,
): StoreConfiguration {
  let anyTemplateChanged = false;
  const templates = { ...configuration.templates };
  for (const page of Object.keys(templates) as (keyof StoreConfiguration["templates"])[]) {
    const template = templates[page];
    let anySectionChanged = false;
    const sections = { ...template.sections };
    for (const [sectionId, section] of Object.entries(sections)) {
      if (section.type !== COLORS_CHANGER_TYPE) continue;
      let anySettingChanged = false;
      const settings = { ...section.settings };
      for (const [key, value] of Object.entries(patch)) {
        // Only mirrors settings this section instance actually declares — never introduces a
        // key that isn't already part of its own saved settings.
        if (!(key in settings) || settings[key] === value) continue;
        settings[key] = value;
        anySettingChanged = true;
      }
      if (!anySettingChanged) continue;
      sections[sectionId] = { ...section, settings };
      anySectionChanged = true;
    }
    if (!anySectionChanged) continue;
    templates[page] = { ...template, sections };
    anyTemplateChanged = true;
  }
  return anyTemplateChanged ? { ...configuration, templates } : configuration;
}
