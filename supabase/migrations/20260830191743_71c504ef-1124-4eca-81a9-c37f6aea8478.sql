CREATE TABLE public.omada_portal_themes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general',
  layout text NOT NULL DEFAULT 'stack',
  decor text NOT NULL DEFAULT 'aurora',
  font_stack text NOT NULL DEFAULT 'system',
  motion text NOT NULL DEFAULT 'subtle',
  tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.omada_portal_themes TO authenticated;
GRANT ALL ON public.omada_portal_themes TO service_role;

ALTER TABLE public.omada_portal_themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can view portal themes"
ON public.omada_portal_themes FOR SELECT TO authenticated
USING (is_active = true OR public.is_super_admin(auth.uid()));

CREATE POLICY "Platform owner manages portal themes"
ON public.omada_portal_themes FOR ALL TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER update_omada_portal_themes_updated_at
BEFORE UPDATE ON public.omada_portal_themes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.omada_portal_templates
  ADD COLUMN IF NOT EXISTS theme_slug text NOT NULL DEFAULT 'modern-minimal';

INSERT INTO public.omada_portal_themes
  (slug, name, description, category, layout, decor, font_stack, motion, sort_order, tokens)
VALUES
  ('modern-minimal','Modern Minimal','Clean white cards, airy spacing and a soft aurora wash. Fastest and most neutral.','minimal','stack','aurora','system','subtle',10,
   '{"ink":"#0b1729","muted":"#5b6b84","brand":"#1d6ef5","accent":"#12b26a","surface":"rgba(255,255,255,.80)","line":"rgba(11,23,41,.10)","bg1":"#eaf1ff","bg2":"#f7fbff","bg3":"#eafaf3","radius":"20px","btnRadius":"14px"}'::jsonb),
  ('coffee-house','Coffee Shop / Café','Warm roasted browns, a torn-ticket receipt card and gentle rising steam.','hospitality','ticket','steam','serif','subtle',20,
   '{"ink":"#2b1a10","muted":"#7a6252","brand":"#8a5a2b","accent":"#3f7d52","surface":"rgba(255,250,244,.92)","line":"rgba(43,26,16,.14)","bg1":"#f3e6d6","bg2":"#faf3e9","bg3":"#e8d6c0","radius":"10px","btnRadius":"10px"}'::jsonb),
  ('cyber-arena','Computer Shop / Gaming','Dark angular panels, a neon grid floor and sharp monospace headings.','gaming','panel','grid-neon','mono','bold',30,
   '{"ink":"#e8f4ff","muted":"#8fa6c4","brand":"#25d0ff","accent":"#b14cff","surface":"rgba(13,20,36,.82)","line":"rgba(37,208,255,.28)","bg1":"#060b16","bg2":"#0b1226","bg3":"#120a24","radius":"6px","btnRadius":"6px"}'::jsonb),
  ('sea-front','Sea Front / Tropical','Turquoise water, layered CSS wave crests and a bright floating hero.','tropical','hero','waves','rounded','subtle',40,
   '{"ink":"#04303a","muted":"#3d6b74","brand":"#0aa3b8","accent":"#f2a541","surface":"rgba(255,255,255,.86)","line":"rgba(4,48,58,.12)","bg1":"#d8f4f7","bg2":"#f2fdfd","bg3":"#bde8ef","radius":"24px","btnRadius":"999px"}'::jsonb),
  ('campus','School / Campus','Ruled-paper backdrop, notebook margin line and a tidy two-column split.','education','split','paper-lines','serif','subtle',50,
   '{"ink":"#161d2f","muted":"#5c667f","brand":"#1f4bb8","accent":"#c8102e","surface":"rgba(255,255,255,.94)","line":"rgba(22,29,47,.12)","bg1":"#eef2fb","bg2":"#ffffff","bg3":"#e6ecf9","radius":"12px","btnRadius":"10px"}'::jsonb),
  ('highland','Mountain / Nature','Layered CSS ridge lines, pine greens and a wide calm hero band.','nature','hero','peaks','system','subtle',60,
   '{"ink":"#10241c","muted":"#4d6b5f","brand":"#1f7a52","accent":"#c2703a","surface":"rgba(255,255,255,.88)","line":"rgba(16,36,28,.12)","bg1":"#e3f0e6","bg2":"#f6fbf6","bg3":"#cfe2d6","radius":"18px","btnRadius":"12px"}'::jsonb),
  ('executive','Business / Professional','Restrained navy panels, a fine mesh pattern and confident uppercase labels.','business','panel','mesh','system','none',70,
   '{"ink":"#0d1b2a","muted":"#5a6a80","brand":"#12395f","accent":"#b58a2b","surface":"rgba(255,255,255,.95)","line":"rgba(13,27,42,.14)","bg1":"#eef1f5","bg2":"#f9fafc","bg3":"#e2e7ee","radius":"8px","btnRadius":"8px"}'::jsonb),
  ('island-resort','Travel / Resort','Sunset gradient, radiating sunburst rays and generous rounded cards.','travel','hero','sunburst','rounded','subtle',80,
   '{"ink":"#3a1d24","muted":"#7d5a5f","brand":"#e2603f","accent":"#0f9b8e","surface":"rgba(255,252,249,.90)","line":"rgba(58,29,36,.12)","bg1":"#ffe6d2","bg2":"#fff6ee","bg3":"#ffd2c2","radius":"26px","btnRadius":"999px"}'::jsonb),
  ('night-neon','Night Neon / Entertainment','Deep night skyline, glowing magenta edges and a stacked card deck.','entertainment','card-deck','neon-city','display','bold',90,
   '{"ink":"#f6e9ff","muted":"#a happens","brand":"#ff3d9a","accent":"#38e8ff","surface":"rgba(22,10,38,.80)","line":"rgba(255,61,154,.30)","bg1":"#0a0517","bg2":"#170a2b","bg3":"#25073a","radius":"18px","btnRadius":"999px"}'::jsonb),
  ('community-store','Community / Local Store','Friendly sari-sari colours, polka-dot texture and a clear price-tag card.','community','ticket','dots','rounded','subtle',100,
   '{"ink":"#25200f","muted":"#6d6547","brand":"#e0362b","accent":"#1f7a3d","surface":"rgba(255,253,245,.94)","line":"rgba(37,32,15,.14)","bg1":"#fff3d6","bg2":"#fffaf0","bg3":"#ffe4b8","radius":"14px","btnRadius":"12px"}'::jsonb),
  ('midnight-glass','Midnight Glass','Dark frosted glass, a slow aurora bloom and quiet high-contrast type.','minimal','stack','aurora-dark','system','subtle',110,
   '{"ink":"#e8eefc","muted":"#93a3c2","brand":"#6f8cff","accent":"#39d3a7","surface":"rgba(18,24,42,.72)","line":"rgba(232,238,252,.14)","bg1":"#070b16","bg2":"#0e1526","bg3":"#101f2c","radius":"22px","btnRadius":"14px"}'::jsonb),
  ('retro-arcade','Retro Arcade','Scanline CRT backdrop, chunky pixel-style type and blocky stacked panels.','gaming','card-deck','scanlines','mono','bold',120,
   '{"ink":"#fdf6e3","muted":"#b3a68a","brand":"#ffb400","accent":"#ff4d6d","surface":"rgba(28,20,44,.86)","line":"rgba(255,180,0,.32)","bg1":"#140d24","bg2":"#1d1233","bg3":"#2a1140","radius":"4px","btnRadius":"4px"}'::jsonb);