UPDATE public.omada_portal_themes
SET tokens = jsonb_set(tokens, '{muted}', '"#b79ad6"'::jsonb)
WHERE slug = 'night-neon';