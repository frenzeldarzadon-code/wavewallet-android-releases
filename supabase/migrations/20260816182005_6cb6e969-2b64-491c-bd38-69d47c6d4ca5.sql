-- 1. Reusable, platform-wide starter catalog -------------------------------
CREATE TABLE IF NOT EXISTS public.retail_catalog_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  name text NOT NULL,
  brand text,
  variant text,
  size_label text,
  unit text NOT NULL DEFAULT 'piece',
  description text,
  sku text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS retail_catalog_templates_key_idx
  ON public.retail_catalog_templates (name, coalesce(brand,''), coalesce(size_label,''), coalesce(variant,''));

GRANT SELECT ON public.retail_catalog_templates TO authenticated, anon;
GRANT ALL ON public.retail_catalog_templates TO service_role;
ALTER TABLE public.retail_catalog_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog templates readable" ON public.retail_catalog_templates;
CREATE POLICY "catalog templates readable" ON public.retail_catalog_templates
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "catalog templates managed by platform owner" ON public.retail_catalog_templates;
CREATE POLICY "catalog templates managed by platform owner" ON public.retail_catalog_templates
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 2. Richer per-shop product records ---------------------------------------
ALTER TABLE public.retail_products
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS variant text,
  ADD COLUMN IF NOT EXISTS size_label text,
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'piece',
  ADD COLUMN IF NOT EXISTS wholesale_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.retail_catalog_templates(id) ON DELETE SET NULL;

-- Existing shops keep exactly the visibility they have today.
UPDATE public.retail_products SET published = true WHERE published = false AND active AND NOT archived;

CREATE UNIQUE INDEX IF NOT EXISTS retail_products_ecosystem_template_idx
  ON public.retail_products (ecosystem_id, template_id) WHERE template_id IS NOT NULL;

-- 3. Only published products reach customers -------------------------------
CREATE OR REPLACE FUNCTION public.list_retail_products(_ecosystem_id uuid)
RETURNS TABLE(id uuid, name text, description text, image_path text, price numeric,
              stock integer, sold_count integer, public_visible boolean,
              rating_avg numeric, rating_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.description, p.image_path, p.price, p.stock, p.sold_count, p.public_visible,
         coalesce((select round(avg(r.rating)::numeric,2) from public.retail_product_ratings r
                    where r.product_id = p.id), 0)::numeric,
         coalesce((select count(*)::int from public.retail_product_ratings r
                    where r.product_id = p.id), 0)
    FROM public.retail_products p
   WHERE p.ecosystem_id = _ecosystem_id
     AND p.active AND p.published AND NOT p.archived
     AND (public.has_membership(auth.uid(), _ecosystem_id)
          OR (p.public_visible AND EXISTS (SELECT 1 FROM public.ecosystems e
                WHERE e.id = _ecosystem_id AND e.public_storefront_enabled)))
   ORDER BY p.category NULLS LAST, p.name;
$$;

-- 4. Seeding a shop from the template catalog ------------------------------
CREATE OR REPLACE FUNCTION public.seed_retail_catalog(_ecosystem_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _added integer;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id)
          or public.is_super_admin(auth.uid())) then
    raise exception 'Only the shop admin can load the starter catalog';
  end if;

  insert into public.retail_products
    (ecosystem_id, template_id, name, description, category, brand, variant, size_label, unit,
     price, wholesale_price, stock, sku, active, published, public_visible)
  select _ecosystem_id, t.id, t.name, t.description, t.category, t.brand, t.variant, t.size_label,
         t.unit, 0, 0, 0, t.sku, true, false, true
    from public.retail_catalog_templates t
   where t.active
     and not exists (select 1 from public.retail_products p
                      where p.ecosystem_id = _ecosystem_id and p.template_id = t.id);
  get diagnostics _added = row_count;
  return _added;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_retail_catalog(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.seed_retail_catalog(uuid) TO authenticated, service_role;

-- 5. Starter Philippine sari-sari / grocery catalog -------------------------
INSERT INTO public.retail_catalog_templates (category, name, brand, variant, size_label, unit, description, sort_order)
VALUES
 ('Rice','Well-milled rice',NULL,NULL,'1 kg','kilogram','Loose well-milled rice sold by the kilo.',10),
 ('Rice','Premium rice',NULL,'Dinorado','1 kg','kilogram','Premium long grain rice.',11),
 ('Rice','Rice',NULL,NULL,'25 kg','sack','Full sack of rice.',12),
 ('Canned goods','Sardines in tomato sauce',NULL,NULL,'155 g','can','Classic canned sardines.',20),
 ('Canned goods','Sardines spicy',NULL,'Spicy','155 g','can','Spicy canned sardines.',21),
 ('Canned goods','Corned beef',NULL,NULL,'150 g','can','Canned corned beef.',22),
 ('Canned goods','Meat loaf',NULL,NULL,'170 g','can','Canned meat loaf.',23),
 ('Canned goods','Luncheon meat',NULL,NULL,'165 g','can','Canned luncheon meat.',24),
 ('Canned goods','Tuna flakes',NULL,'Afritada','155 g','can','Canned tuna flakes.',25),
 ('Canned goods','Pork and beans',NULL,NULL,'230 g','can','Pork and beans in tomato sauce.',26),
 ('Canned goods','Canned fruit cocktail',NULL,NULL,'432 g','can','Fruit cocktail in syrup.',27),
 ('Instant noodles','Instant pancit canton',NULL,'Original','60 g','pack','Stir-fry instant noodles.',30),
 ('Instant noodles','Instant pancit canton',NULL,'Chilimansi','60 g','pack','Chilimansi flavour instant noodles.',31),
 ('Instant noodles','Instant mami noodles',NULL,'Beef','55 g','pack','Instant soup noodles.',32),
 ('Instant noodles','Instant mami noodles',NULL,'Chicken','55 g','pack','Instant soup noodles.',33),
 ('Instant noodles','Cup noodles',NULL,NULL,'70 g','cup','Instant cup noodles.',34),
 ('Coffee','3-in-1 coffee mix',NULL,'Original','20 g','sachet','Instant coffee mix sachet.',40),
 ('Coffee','3-in-1 coffee mix',NULL,'Brown sugar','25 g','sachet','Instant coffee mix sachet.',41),
 ('Coffee','Instant coffee refill',NULL,NULL,'50 g','pack','Pure instant coffee refill.',42),
 ('Coffee','Coffee twin pack',NULL,NULL,'2 x 20 g','pack','Twin pack coffee mix.',43),
 ('Powdered drinks','Powdered juice drink',NULL,'Orange','25 g','sachet','Makes 1 litre.',50),
 ('Powdered drinks','Powdered juice drink',NULL,'Mango','25 g','sachet','Makes 1 litre.',51),
 ('Powdered drinks','Chocolate malt drink',NULL,NULL,'22 g','sachet','Chocolate powdered drink.',52),
 ('Powdered drinks','Powdered milk drink',NULL,NULL,'33 g','sachet','Powdered milk drink.',53),
 ('Biscuits and snacks','Cracker sandwich',NULL,'Cheese','30 g','pack','Sandwich crackers.',60),
 ('Biscuits and snacks','Cracker sandwich',NULL,'Peanut butter','30 g','pack','Sandwich crackers.',61),
 ('Biscuits and snacks','Soda crackers',NULL,NULL,'250 g','pack','Plain soda crackers.',62),
 ('Biscuits and snacks','Corn chips',NULL,'Cheese','55 g','pack','Extruded corn snack.',63),
 ('Biscuits and snacks','Potato chips',NULL,NULL,'50 g','pack','Fried potato chips.',64),
 ('Biscuits and snacks','Peanuts',NULL,'Adobo','40 g','pack','Coated peanuts.',65),
 ('Biscuits and snacks','Candy assorted',NULL,NULL,'per piece','piece','Assorted hard candy.',66),
 ('Biscuits and snacks','Chocolate bar',NULL,NULL,'30 g','bar','Chocolate bar.',67),
 ('Bread and bakery','Pandesal',NULL,NULL,'per piece','piece','Freshly baked pandesal.',70),
 ('Bread and bakery','Loaf bread',NULL,NULL,'400 g','loaf','Sliced white loaf bread.',71),
 ('Bread and bakery','Sponge cake snack',NULL,NULL,'per piece','piece','Individually wrapped snack cake.',72),
 ('Condiments and sauces','Soy sauce',NULL,NULL,'385 ml','bottle','All-purpose soy sauce.',80),
 ('Condiments and sauces','Vinegar',NULL,NULL,'385 ml','bottle','Cane vinegar.',81),
 ('Condiments and sauces','Fish sauce (patis)',NULL,NULL,'350 ml','bottle','Fish sauce.',82),
 ('Condiments and sauces','Banana ketchup',NULL,NULL,'320 g','bottle','Sweet banana ketchup.',83),
 ('Condiments and sauces','Tomato sauce',NULL,NULL,'200 g','pouch','Tomato sauce pouch.',84),
 ('Condiments and sauces','Oyster sauce',NULL,NULL,'150 g','bottle','Oyster sauce.',85),
 ('Condiments and sauces','Soy sauce sachet',NULL,NULL,'50 ml','sachet','Single-serve soy sauce.',86),
 ('Cooking ingredients','All-purpose seasoning',NULL,NULL,'8 g','sachet','Granulated seasoning.',90),
 ('Cooking ingredients','Bouillon cube',NULL,'Pork','10 g','piece','Broth cube.',91),
 ('Cooking ingredients','Sinigang mix',NULL,'Sampalok','40 g','sachet','Tamarind soup base.',92),
 ('Cooking ingredients','Adobo mix',NULL,NULL,'40 g','sachet','Adobo seasoning mix.',93),
 ('Cooking ingredients','Garlic',NULL,NULL,'100 g','pack','Fresh garlic.',94),
 ('Cooking ingredients','Onion',NULL,NULL,'per piece','piece','Fresh red onion.',95),
 ('Cooking oil','Cooking oil',NULL,NULL,'1 L','bottle','Refined vegetable cooking oil.',100),
 ('Cooking oil','Cooking oil sachet',NULL,NULL,'100 ml','sachet','Single-use cooking oil.',101),
 ('Sugar and salt','White sugar',NULL,NULL,'1 kg','kilogram','Refined white sugar.',110),
 ('Sugar and salt','Brown sugar',NULL,NULL,'1 kg','kilogram','Washed brown sugar.',111),
 ('Sugar and salt','Iodized salt',NULL,NULL,'500 g','pack','Iodized table salt.',112),
 ('Beverages','Soft drink in bottle',NULL,'Cola','290 ml','bottle','Chilled soft drink.',120),
 ('Beverages','Soft drink in can',NULL,'Cola','330 ml','can','Canned soft drink.',121),
 ('Beverages','Soft drink 1.5 L',NULL,NULL,'1.5 L','bottle','Family size soft drink.',122),
 ('Beverages','Ready-to-drink juice',NULL,NULL,'250 ml','pack','Juice drink in tetra pack.',123),
 ('Beverages','Energy drink',NULL,NULL,'240 ml','bottle','Energy drink.',124),
 ('Beverages','Beer',NULL,NULL,'330 ml','bottle','Bottled beer (age restricted).',125),
 ('Water','Purified drinking water',NULL,NULL,'350 ml','bottle','Bottled purified water.',130),
 ('Water','Purified drinking water',NULL,NULL,'1 L','bottle','Bottled purified water.',131),
 ('Water','Refill water container',NULL,NULL,'20 L','container','Refill of purified water.',132),
 ('Dairy','Evaporated milk',NULL,NULL,'370 ml','can','Evaporated filled milk.',140),
 ('Dairy','Condensed milk',NULL,NULL,'300 ml','can','Sweetened condensed milk.',141),
 ('Dairy','Powdered milk',NULL,NULL,'150 g','pack','Full cream powdered milk.',142),
 ('Dairy','Cheese block',NULL,NULL,'165 g','pack','Processed cheese.',143),
 ('Dairy','Butter or margarine',NULL,NULL,'100 g','pack','Spread for bread and cooking.',144),
 ('Dairy','Fresh eggs',NULL,NULL,'per piece','piece','Fresh chicken egg.',145),
 ('Frozen and processed food','Hotdog',NULL,NULL,'250 g','pack','Chilled hotdog.',150),
 ('Frozen and processed food','Longganisa',NULL,NULL,'250 g','pack','Native sausage.',151),
 ('Frozen and processed food','Tocino',NULL,NULL,'250 g','pack','Cured sweet pork.',152),
 ('Frozen and processed food','Chicken nuggets',NULL,NULL,'200 g','pack','Frozen breaded nuggets.',153),
 ('Frozen and processed food','Ice candy or ice',NULL,NULL,'per piece','piece','Frozen treat or ice.',154),
 ('Toiletries and personal care','Bath soap',NULL,NULL,'90 g','bar','Bath soap bar.',160),
 ('Toiletries and personal care','Shampoo sachet',NULL,NULL,'12 ml','sachet','Single-use shampoo.',161),
 ('Toiletries and personal care','Conditioner sachet',NULL,NULL,'12 ml','sachet','Single-use conditioner.',162),
 ('Toiletries and personal care','Toothpaste',NULL,NULL,'70 g','tube','Fluoride toothpaste.',163),
 ('Toiletries and personal care','Toothbrush',NULL,NULL,'per piece','piece','Adult toothbrush.',164),
 ('Toiletries and personal care','Sanitary napkin',NULL,NULL,'8 pads','pack','Sanitary napkins.',165),
 ('Toiletries and personal care','Baby diaper',NULL,'Medium','per piece','piece','Disposable diaper.',166),
 ('Toiletries and personal care','Alcohol',NULL,'70% solution','250 ml','bottle','Isopropyl or ethyl alcohol.',167),
 ('Toiletries and personal care','Tissue roll',NULL,NULL,'per roll','roll','Bathroom tissue.',168),
 ('Laundry and cleaning','Detergent powder sachet',NULL,NULL,'60 g','sachet','Single-wash detergent.',170),
 ('Laundry and cleaning','Detergent powder',NULL,NULL,'1 kg','pack','Laundry detergent powder.',171),
 ('Laundry and cleaning','Fabric conditioner sachet',NULL,NULL,'25 ml','sachet','Fabric conditioner.',172),
 ('Laundry and cleaning','Laundry bar soap',NULL,NULL,'380 g','bar','Laundry bar soap.',173),
 ('Laundry and cleaning','Dishwashing liquid',NULL,NULL,'250 ml','bottle','Dishwashing liquid.',174),
 ('Laundry and cleaning','Bleach',NULL,NULL,'1 L','bottle','Household bleach.',175),
 ('Laundry and cleaning','Toilet cleaner',NULL,NULL,'500 ml','bottle','Toilet bowl cleaner.',176),
 ('Household supplies','Candle',NULL,NULL,'per piece','piece','Household candle.',180),
 ('Household supplies','Matches',NULL,NULL,'per box','box','Safety matches.',181),
 ('Household supplies','Batteries',NULL,'AA','2 pieces','pack','Dry cell batteries.',182),
 ('Household supplies','LED bulb',NULL,NULL,'7 W','piece','LED light bulb.',183),
 ('Household supplies','Broom (walis tambo)',NULL,NULL,'per piece','piece','Soft broom.',184),
 ('Household supplies','Trash bag',NULL,'Medium','10 pieces','pack','Plastic trash bags.',185),
 ('Household supplies','Clothesline rope',NULL,NULL,'10 m','roll','Nylon rope.',186),
 ('School and convenience','Ballpen',NULL,NULL,'per piece','piece','Ballpoint pen.',190),
 ('School and convenience','Pencil',NULL,NULL,'per piece','piece','Wooden pencil.',191),
 ('School and convenience','Notebook',NULL,NULL,'80 leaves','piece','Spiral or stitched notebook.',192),
 ('School and convenience','Pad paper',NULL,NULL,'80 leaves','pad','Intermediate pad paper.',193),
 ('School and convenience','Envelope',NULL,'Long','per piece','piece','Brown envelope.',194),
 ('School and convenience','Load card or e-load',NULL,NULL,'per load','piece','Prepaid mobile load.',195),
 ('School and convenience','Cigarette stick',NULL,NULL,'per piece','piece','Age-restricted item.',196),
 ('School and convenience','Umbrella',NULL,NULL,'per piece','piece','Folding umbrella.',197),
 ('Local Sagada goods','Sagada coffee beans',NULL,'Arabica','250 g','pack','Locally grown coffee beans.',200),
 ('Local Sagada goods','Sagada orange',NULL,NULL,'per kilo','kilogram','Local citrus in season.',201),
 ('Local Sagada goods','Etag (cured pork)',NULL,NULL,'250 g','pack','Traditional cured pork.',202),
 ('Local Sagada goods','Highland vegetables',NULL,NULL,'per kilo','kilogram','Assorted highland vegetables.',203),
 ('Local Sagada goods','Woven souvenir item',NULL,NULL,'per piece','piece','Locally woven handicraft.',204)
ON CONFLICT DO NOTHING;

-- 6. Every new shop starts with the catalog loaded (unpublished) -----------
CREATE OR REPLACE FUNCTION public.create_ecosystem(_name text, _slug text DEFAULT NULL::text, _description text DEFAULT NULL::text, _contact_email text DEFAULT NULL::text, _contact_phone text DEFAULT NULL::text, _plan_name text DEFAULT 'Starter'::text, _plan_price numeric DEFAULT 0, _grace_period_days integer DEFAULT 5, _signup_enabled boolean DEFAULT true)
 RETURNS ecosystems
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _base text;
  _candidate text;
  _n integer := 1;
  _row public.ecosystems;
  _actor text;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Only platform owners can create shops';
  end if;
  if coalesce(trim(_name),'') = '' then
    raise exception 'A shop needs a name';
  end if;
  if _plan_price < 0 then raise exception 'Plan price cannot be negative'; end if;
  if _grace_period_days < 0 or _grace_period_days > 90 then
    raise exception 'Grace period must be between 0 and 90 days';
  end if;

  _base := public.slugify(coalesce(nullif(trim(_slug),''), _name));
  if _base = '' then _base := 'shop'; end if;
  _candidate := _base;
  while exists (select 1 from public.ecosystems where slug = _candidate) loop
    _n := _n + 1;
    _candidate := _base || '-' || _n;
  end loop;

  insert into public.ecosystems
    (name, slug, description, contact_email, contact_phone,
     plan_name, plan_price, grace_period_days, signup_enabled,
     subscription_state, current_period_end)
  values
    (trim(_name), _candidate, nullif(trim(_description),''),
     nullif(lower(trim(_contact_email)),''), nullif(trim(_contact_phone),''),
     coalesce(nullif(trim(_plan_name),''), 'Starter'), _plan_price,
     _grace_period_days, coalesce(_signup_enabled, true),
     'active', null)
  returning * into _row;

  perform public.seed_retail_catalog(_row.id);

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_row.id, auth.uid(), coalesce(_actor,'Super admin'), 'Created shop', _row.name,
          jsonb_build_object('slug', _row.slug, 'status', 'active'));
  return _row;
end;
$function$;