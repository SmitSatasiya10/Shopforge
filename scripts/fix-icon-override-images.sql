-- One-off cleanup: resets icon_N_image / custom_icon_N / image_N / image / button_custom_icon
-- settings back to "" wherever the AI image-fill pipeline incorrectly populated them with a
-- real product photo, overriding the block's intended default Material Symbols icon. Root
-- cause fixed in lib/ai/images.ts + lib/ai/catalog/blocks/*.json (_optional_image_settings);
-- this only cleans up data generated before that fix. Safe to re-run — a no-op once clean.
BEGIN;

DO $$
DECLARE
  r RECORD;
  affected INT := 0;
BEGIN
  FOR r IN
    SELECT p.id AS project_id, tname, sname, bname, kv.key AS setting_key
    FROM "Project" p,
         jsonb_each(p."configurationJson"->'templates') AS tpl(tname, tval),
         jsonb_each(tpl.tval->'sections') AS sec(sname, sval),
         jsonb_each(sec.sval->'blocks') AS blk(bname, b),
         jsonb_each_text(b->'settings') AS kv(key, value)
    WHERE (
      (b->>'type' = 'product_shipping-checkpoints' AND kv.key IN ('icon_1_image','icon_2_image','icon_3_image','icon_4_image'))
      OR (b->>'type' = 'product_sizing-chart' AND kv.key = 'button_custom_icon')
      OR (b->>'type' = 'text-with-icon' AND kv.key IN ('custom_icon_1','custom_icon_2','custom_icon_3','custom_icon_4'))
      OR (b->>'type' = 'icon-with-content' AND kv.key = 'image')
      OR (b->>'type' = 'icon_with_content' AND kv.key = 'image')
      OR (b->>'type' = 'icon-with-text' AND kv.key IN ('image_1','image_2','image_3','image_4','image_5','image_6'))
      OR (b->>'type' = 'text_with_icon' AND kv.key IN ('custom_icon_1','custom_icon_2','custom_icon_3'))
    )
    AND kv.value <> '' AND kv.value <> 'null'
  LOOP
    UPDATE "Project"
    SET "configurationJson" = jsonb_set(
      "configurationJson",
      ARRAY['templates', r.tname, 'sections', r.sname, 'blocks', r.bname, 'settings', r.setting_key],
      '""'::jsonb
    )
    WHERE id = r.project_id;
    affected := affected + 1;
  END LOOP;
  RAISE NOTICE 'Cleared % icon-override image settings', affected;
END $$;

COMMIT;
