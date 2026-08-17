-- Real Philippine sari-sari starter catalog with product photos + wholesale minimums.

ALTER TABLE public.retail_catalog_templates
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS default_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_wholesale_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wholesale_min_qty integer NOT NULL DEFAULT 0;

ALTER TABLE public.retail_products
  ADD COLUMN IF NOT EXISTS wholesale_min_qty integer NOT NULL DEFAULT 0;

-- The old placeholder templates stay in place for history but no longer seed
-- new shops; products already copied into a shop are untouched.
UPDATE public.retail_catalog_templates SET active = false WHERE image_path IS NULL;

INSERT INTO public.retail_catalog_templates
  (category, name, brand, variant, size_label, unit, description, image_path,
   default_price, default_wholesale_price, wholesale_min_qty, sort_order)
VALUES
('Coffee', 'Kopiko Black 3-in-1 Coffee Mix', 'Kopiko', 'Black 3-in-1', '30 g sachet', 'sachet', 'Kopiko Black 3-in-1 30 g sachet', 'catalog/kopiko-black-3in1-sachet.jpg', 10, 9, 12, 100),
 ('Coffee', 'Kopiko Brown Coffee Mix', 'Kopiko', 'Brown', '25 g sachet', 'sachet', 'Kopiko Brown 25 g sachet', 'catalog/kopiko-brown-sachet.jpg', 10, 9, 12, 110),
 ('Coffee', 'Kopiko Blanca Coffee Mix', 'Kopiko', 'Blanca', '30 g sachet', 'sachet', 'Kopiko Blanca 30 g sachet', 'catalog/kopiko-blanca-sachet.jpg', 10, 9, 12, 120),
 ('Coffee', 'Great Taste White Coffee Mix', 'Great Taste', 'White', '25 g sachet', 'sachet', 'Great Taste White 25 g sachet', 'catalog/great-taste-white.jpg', 10, 9, 12, 130),
 ('Coffee', 'NESCAFE 3-in-1 Original Coffee Mix', 'NESCAFE', 'Original', '20 g sachet', 'sachet', 'NESCAFE Original 20 g sachet', 'catalog/nescafe-original-3in1.jpg', 10, 9, 12, 140),
 ('Coffee', 'NESCAFE Creamy White Coffee Mix', 'NESCAFE', 'Creamy White', '27 g sachet', 'sachet', 'NESCAFE Creamy White 27 g sachet', 'catalog/nescafe-creamy-white.jpg', 12, 11, 12, 150),
 ('Coffee', 'NESCAFE Classic Instant Coffee', 'NESCAFE', 'Classic', '50 g', 'jar', 'NESCAFE Classic 50 g', 'catalog/nescafe-classic-jar.jpg', 95, 88, 6, 160),
 ('Beverages', 'MILO Activ-Go Chocolate Malt Drink', 'MILO', 'Activ-Go', '24 g sachet', 'sachet', 'MILO Activ-Go 24 g sachet', 'catalog/milo-sachet.jpg', 10, 9, 12, 170),
 ('Beverages', 'Bear Brand Fortified Chocomilk Drink', 'Bear Brand', 'Chocolate', '33 g sachet', 'sachet', 'Bear Brand Chocolate 33 g sachet', 'catalog/bear-brand-powder.jpg', 15, 13, 12, 180),
 ('Dairy', 'NESTLE All Purpose Cream', 'NESTLE', 'All Purpose', '250 ml', 'pack', 'NESTLE All Purpose 250 ml', 'catalog/nestle-all-purpose-cream.jpg', 58, 54, 6, 190),
 ('Dairy', 'Alaska Evaporated Filled Milk', 'Alaska', 'Evaporated', '140 ml', 'can', 'Alaska Evaporated 140 ml', 'catalog/alaska-evap.jpg', 22, 20, 12, 200),
 ('Soft drinks', 'Coca-Cola Regular', 'Coca-Cola', 'Regular', '330 ml', 'bottle', 'Coca-Cola Regular 330 ml', 'catalog/coke-mismo.jpg', 25, 22, 12, 210),
 ('Soft drinks', 'Sprite Lemon-Lime Soda', 'Sprite', 'Regular', '330 ml', 'bottle', 'Sprite Regular 330 ml', 'catalog/sprite.jpg', 25, 22, 12, 220),
 ('Soft drinks', 'Royal Tru-Orange Soda', 'Royal', 'Orange', '330 ml', 'bottle', 'Royal Orange 330 ml', 'catalog/royal.jpg', 25, 22, 12, 230),
 ('Soft drinks', 'Pepsi Cola', 'Pepsi', 'Regular', '330 ml', 'bottle', 'Pepsi Regular 330 ml', 'catalog/pepsi.jpg', 24, 21, 12, 240),
 ('Beverages', 'C2 Green Tea Apple', 'C2', 'Apple', '230 ml', 'bottle', 'C2 Apple 230 ml', 'catalog/c2-apple.jpg', 30, 27, 12, 250),
 ('Beverages', 'Tang Powdered Juice Orange', 'Tang', 'Orange', '25 g sachet', 'sachet', 'Tang Orange 25 g sachet', 'catalog/tang-orange.jpg', 12, 10, 12, 260),
 ('Instant noodles', 'Lucky Me! Pancit Canton Original', 'Lucky Me!', 'Original', '60 g', 'pack', 'Lucky Me! Original 60 g', 'catalog/lucky-me-pancit-canton.jpg', 18, 16, 12, 270),
 ('Instant noodles', 'Lucky Me! Pancit Canton Chilimansi', 'Lucky Me!', 'Chilimansi', '60 g', 'pack', 'Lucky Me! Chilimansi 60 g', 'catalog/lucky-me-chilimansi.jpg', 18, 16, 12, 280),
 ('Instant noodles', 'Lucky Me! Instant Mami Beef', 'Lucky Me!', 'Beef', '55 g', 'pack', 'Lucky Me! Beef 55 g', 'catalog/lucky-me-beef-mami.jpg', 15, 13, 12, 290),
 ('Instant noodles', 'Payless Pancit Canton', 'Payless', 'Original', '65 g', 'pack', 'Payless Original 65 g', 'catalog/payless-pancit-canton.jpg', 15, 13, 12, 300),
 ('Instant noodles', 'Nissin Cup Noodles', 'Nissin', 'Original', '40 g', 'cup', 'Nissin Original 40 g', 'catalog/nissin-cup-noodles.jpg', 35, 32, 6, 310),
 ('Canned goods', '555 Sardines in Tomato Sauce Hot', '555', 'Hot', '155 g', 'can', '555 Hot 155 g', 'catalog/555-sardines.jpg', 28, 26, 12, 320),
 ('Canned goods', 'Ligo Sardines in Tomato Sauce', 'Ligo', 'Tomato Sauce', '155 g', 'can', 'Ligo Tomato Sauce 155 g', 'catalog/ligo-sardines.jpg', 28, 26, 12, 330),
 ('Canned goods', 'Century Tuna Flakes in Oil', 'Century Tuna', 'Flakes in Oil', '155 g', 'can', 'Century Tuna Flakes in Oil 155 g', 'catalog/century-tuna-flakes.jpg', 45, 42, 12, 340),
 ('Canned goods', 'Argentina Corned Beef', 'Argentina', 'Corned Beef', '150 g', 'can', 'Argentina Corned Beef 150 g', 'catalog/argentina-corned-beef.jpg', 45, 42, 12, 350),
 ('Canned goods', 'SPAM Classic Luncheon Meat', 'SPAM', 'Classic', '340 g', 'can', 'SPAM Classic 340 g', 'catalog/spam-luncheon.jpg', 210, 198, 6, 360),
 ('Canned goods', 'CDO Luncheon Meat', 'CDO', 'Luncheon Meat', '350 g', 'can', 'CDO Luncheon Meat 350 g', 'catalog/cdo-meat-loaf.jpg', 95, 89, 6, 370),
 ('Condiments', 'Del Monte Tomato Sauce Original', 'Del Monte', 'Original Style', '115 g', 'pouch', 'Del Monte Original Style 115 g', 'catalog/del-monte-tomato-sauce.jpg', 15, 13, 12, 380),
 ('Condiments', 'UFC Banana Catsup', 'UFC', 'Banana', '320 g', 'bottle', 'UFC Banana 320 g', 'catalog/ufc-banana-ketchup.jpg', 45, 42, 6, 390),
 ('Condiments', 'Datu Puti Soy Sauce', 'Datu Puti', 'Soy Sauce', '385 ml', 'bottle', 'Datu Puti Soy Sauce 385 ml', 'catalog/datu-puti-soy.jpg', 32, 29, 12, 400),
 ('Condiments', 'Datu Puti Vinegar', 'Datu Puti', 'Vinegar', '385 ml', 'bottle', 'Datu Puti Vinegar 385 ml', 'catalog/datu-puti-vinegar.jpg', 28, 26, 12, 410),
 ('Condiments', 'Silver Swan Soy Sauce', 'Silver Swan', 'Soy Sauce', '385 ml', 'bottle', 'Silver Swan Soy Sauce 385 ml', 'catalog/silver-swan-soy.jpg', 33, 30, 12, 420),
 ('Cooking', 'Knorr Sinigang sa Sampaloc Mix', 'Knorr', 'Sinigang sa Sampaloc', '44 g', 'pack', 'Knorr Sinigang sa Sampaloc 44 g', 'catalog/knorr-sinigang-mix.jpg', 16, 14, 12, 430),
 ('Cooking', 'Maggi Magic Sarap All-in-One Seasoning', 'Maggi', 'Magic Sarap', '8 g sachet', 'sachet', 'Maggi Magic Sarap 8 g sachet', 'catalog/maggi-magic-sarap.jpg', 6, 5, 24, 440),
 ('Cooking', 'Ajinomoto Umami Seasoning', 'Ajinomoto', 'Umami', '11 g sachet', 'sachet', 'Ajinomoto Umami 11 g sachet', 'catalog/ajinomoto.jpg', 6, 5, 24, 450),
 ('Cooking', 'Star Margarine Classic', 'Star', 'Classic', '100 g', 'pack', 'Star Classic 100 g', 'catalog/star-margarine.jpg', 28, 26, 12, 460),
 ('Condiments', 'Lady''s Choice Real Mayonnaise', 'Lady''s Choice', 'Real Mayonnaise', '220 ml', 'jar', 'Lady''s Choice Real Mayonnaise 220 ml', 'catalog/lady-s-choice-mayo.jpg', 75, 70, 6, 470),
 ('Biscuits', 'M.Y. San SkyFlakes Crackers', 'SkyFlakes', 'Plain', '25 g', 'pack', 'SkyFlakes Plain 25 g', 'catalog/skyflakes.jpg', 8, 7, 24, 480),
 ('Biscuits', 'Rebisco Sandwich Crackers', 'Rebisco', 'Sandwich', '32 g', 'pack', 'Rebisco Sandwich 32 g', 'catalog/rebisco-crackers.jpg', 8, 7, 24, 490),
 ('Biscuits', 'Fita Crackers', 'Fita', 'Original', '30 g', 'pack', 'Fita Original 30 g', 'catalog/fita.jpg', 10, 9, 24, 500),
 ('Biscuits', 'Oreo Chocolate Sandwich Cookies', 'Oreo', 'Original', '29.4 g', 'pack', 'Oreo Original 29.4 g', 'catalog/oreo.jpg', 15, 13, 12, 510),
 ('Snacks', 'Piattos Cheese Potato Crisps', 'Piattos', 'Cheese', '40 g', 'pack', 'Piattos Cheese 40 g', 'catalog/piattos.jpg', 25, 22, 12, 520),
 ('Snacks', 'Nova Multigrain Snack Country Cheddar', 'Nova', 'Country Cheddar', '40 g', 'pack', 'Nova Country Cheddar 40 g', 'catalog/nova.jpg', 25, 22, 12, 530),
 ('Snacks', 'Chippy Corn Chips Barbecue', 'Chippy', 'Barbecue', '110 g', 'pack', 'Chippy Barbecue 110 g', 'catalog/chippy.jpg', 32, 29, 12, 540),
 ('Snacks', 'Boy Bawang Cornick Garlic', 'Boy Bawang', 'Garlic', '100 g', 'pack', 'Boy Bawang Garlic 100 g', 'catalog/boy-bawang.jpg', 25, 22, 12, 550),
 ('Snacks', 'Nissin Pillows Choco Filled Snack', 'Nissin', 'Chocolate', '38 g', 'pack', 'Nissin Chocolate 38 g', 'catalog/pillows.jpg', 20, 18, 12, 560),
 ('Candy', 'Cloud 9 Chocolate Bar', 'Cloud 9', 'Original', '30 g', 'bar', 'Cloud 9 Original 30 g', 'catalog/cloud9.jpg', 12, 10, 24, 570),
 ('Candy', 'Maxx Candy', 'Maxx', 'Assorted', '1 piece', 'piece', 'Maxx Assorted 1 piece', 'catalog/maxx-candy.jpg', 2, 1.5, 50, 580),
 ('Candy', 'Mentos Chewy Mints', 'Mentos', 'Mint', 'Roll', 'roll', 'Mentos Mint Roll', 'catalog/mentos.jpg', 20, 18, 12, 590),
 ('Laundry', 'Tide Detergent Bar', 'Tide', 'Bar', '125 g', 'bar', 'Tide Bar 125 g', 'catalog/tide-bar.jpg', 20, 18, 12, 600),
 ('Laundry', 'Surf Powder Detergent', 'Surf', 'Powder', '70 g sachet', 'sachet', 'Surf Powder 70 g sachet', 'catalog/surf-powder.jpg', 10, 9, 24, 610),
 ('Personal care', 'Safeguard Antibacterial Soap Classic White', 'Safeguard', 'Classic White', '130 g', 'bar', 'Safeguard Classic White 130 g', 'catalog/safeguard-soap.jpg', 45, 42, 12, 620),
 ('Personal care', 'Palmolive Naturals Shampoo', 'Palmolive', 'Naturals', '12 ml sachet', 'sachet', 'Palmolive Naturals 12 ml sachet', 'catalog/palmolive-shampoo.jpg', 7, 6, 24, 630),
 ('Personal care', 'Head & Shoulders Anti-Dandruff Shampoo', 'Head & Shoulders', 'Citrus Fresh', '12 ml sachet', 'sachet', 'Head & Shoulders Citrus Fresh 12 ml sachet', 'catalog/head-shoulders.jpg', 9, 8, 24, 640),
 ('Personal care', 'Closeup Toothpaste Red Hot', 'Closeup', 'Red Hot', '65 g', 'tube', 'Closeup Red Hot 65 g', 'catalog/closeup.jpg', 55, 51, 6, 650),
 ('Personal care', 'Rexona Roll-On Deodorant', 'Rexona', 'Powder Dry', '25 ml', 'piece', 'Rexona Powder Dry 25 ml', 'catalog/rexona-deo.jpg', 75, 70, 6, 660),
 ('Instant noodles', 'Lucky Me! La Paz Batchoy Cup', 'Lucky Me!', 'La Paz Batchoy', '70 g cup', 'cup', 'Lucky Me! La Paz Batchoy 70 g cup', 'catalog/lucky-me-la-paz.jpg', 25, 22, 12, 670),
 ('Candy', 'Kopiko Coffee Candy', 'Kopiko', 'Coffee', '1 piece', 'piece', 'Kopiko Coffee 1 piece', 'catalog/kopiko-candy.jpg', 2, 1.5, 50, 680),
 ('Beverages', 'Chuckie Chocolate Milk Drink', 'Chuckie', 'Chocolate', '110 ml', 'pack', 'Chuckie Chocolate 110 ml', 'catalog/chuckie.jpg', 18, 16, 12, 690),
 ('Dairy', 'Birch Tree Fortified Powdered Milk Drink', 'Birch Tree', 'Fortified', '33 g sachet', 'sachet', 'Birch Tree Fortified 33 g sachet', 'catalog/birch-tree.jpg', 15, 13, 12, 700),
 ('Dairy', 'Eden Filled Cheese', 'Eden', 'Original', '165 g', 'pack', 'Eden Original 165 g', 'catalog/eden-cheese.jpg', 68, 63, 6, 710),
 ('Bakery', 'Gardenia Classic White Bread', 'Gardenia', 'Classic White', '600 g', 'loaf', 'Gardenia Classic White 600 g', 'catalog/gardenia-loaf.jpg', 72, 68, 6, 720),
 ('Tobacco', 'Marlboro Red Cigarettes', 'Marlboro', 'Red', '20 sticks', 'pack', 'Marlboro Red 20 sticks', 'catalog/marlboro.jpg', 145, 140, 10, 730),
 ('Coffee', 'Great Taste White Crema Coffee Mix', 'Great Taste', 'White Crema', '30 g sachet', 'sachet', 'Great Taste White Crema 30 g sachet', 'catalog/great-taste-white-crema.jpg', 12, 11, 12, 740),
 ('Coffee', 'San Mig Coffee 3-in-1 Original', 'San Mig Coffee', 'Original', '20 g sachet', 'sachet', 'San Mig Coffee Original 20 g sachet', 'catalog/san-mig-coffee.jpg', 8, 7, 12, 750)
ON CONFLICT (name, coalesce(brand,''), coalesce(size_label,''), coalesce(variant,''))
DO UPDATE SET category = excluded.category,
              unit = excluded.unit,
              description = excluded.description,
              image_path = excluded.image_path,
              default_price = excluded.default_price,
              default_wholesale_price = excluded.default_wholesale_price,
              wholesale_min_qty = excluded.wholesale_min_qty,
              sort_order = excluded.sort_order,
              active = true,
              updated_at = now();

-- Seeding now carries the photo, suggested prices and wholesale minimum.
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
     image_path, price, wholesale_price, wholesale_min_qty, stock, sku, active, published, public_visible)
  select _ecosystem_id, t.id, t.name, t.description, t.category, t.brand, t.variant, t.size_label,
         t.unit, t.image_path, t.default_price, t.default_wholesale_price, t.wholesale_min_qty,
         0, t.sku, true, false, true
    from public.retail_catalog_templates t
   where t.active
     and not exists (select 1 from public.retail_products p
                      where p.ecosystem_id = _ecosystem_id and p.template_id = t.id);
  get diagnostics _added = row_count;

  -- Fill in photos that a shop is still missing without touching admin edits.
  update public.retail_products p
     set image_path = t.image_path
    from public.retail_catalog_templates t
   where p.template_id = t.id
     and p.ecosystem_id = _ecosystem_id
     and p.image_path is null
     and t.image_path is not null;

  return _added;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_retail_catalog(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.seed_retail_catalog(uuid) TO authenticated, service_role;

-- Enabling retail for the first time seeds the same real catalog.
CREATE OR REPLACE FUNCTION public.update_store_settings(
  _ecosystem_id uuid, _voucher_enabled boolean, _retail_enabled boolean,
  _cash_enabled boolean, _credit_enabled boolean, _pickup_enabled boolean,
  _delivery_enabled boolean, _public_storefront boolean)
RETURNS TABLE (voucher_enabled boolean, retail_enabled boolean, cash_enabled boolean,
               credit_enabled boolean, pickup_enabled boolean, delivery_enabled boolean,
               public_storefront boolean, seeded integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
declare _row public.ecosystems; _actor text; _seeded integer := 0;
begin
  if not (public.is_ecosystem_admin(auth.uid(), _ecosystem_id) or public.is_super_admin(auth.uid())) then
    raise exception 'Not authorized to manage this shop';
  end if;

  if _retail_enabled and not (_cash_enabled or _credit_enabled) then
    raise exception 'Enable at least one retail payment method (cash or shop coins)';
  end if;

  update public.ecosystems
     set store_voucher_enabled    = coalesce(_voucher_enabled, store_voucher_enabled),
         store_retail_enabled     = coalesce(_retail_enabled, store_retail_enabled),
         retail_cash_enabled      = coalesce(_cash_enabled, retail_cash_enabled),
         retail_credit_enabled    = coalesce(_credit_enabled, retail_credit_enabled),
         retail_pickup_enabled    = coalesce(_pickup_enabled, retail_pickup_enabled),
         retail_delivery_enabled  = coalesce(_delivery_enabled, retail_delivery_enabled),
         public_storefront_enabled= coalesce(_public_storefront, public_storefront_enabled)
   where id = _ecosystem_id
  returning * into _row;

  if _row.id is null then raise exception 'Shop not found'; end if;

  if _row.store_retail_enabled then
    insert into public.retail_products
      (ecosystem_id, template_id, name, description, category, brand, variant, size_label, unit,
       image_path, price, wholesale_price, wholesale_min_qty, stock, sku, active, published, public_visible)
    select _ecosystem_id, t.id, t.name, t.description, t.category, t.brand, t.variant, t.size_label,
           t.unit, t.image_path, t.default_price, t.default_wholesale_price, t.wholesale_min_qty,
           0, t.sku, true, false, true
      from public.retail_catalog_templates t
     where t.active
       and not exists (select 1 from public.retail_products p
                        where p.ecosystem_id = _ecosystem_id and p.template_id = t.id);
    get diagnostics _seeded = row_count;

    update public.retail_products p
       set image_path = t.image_path
      from public.retail_catalog_templates t
     where p.template_id = t.id
       and p.ecosystem_id = _ecosystem_id
       and p.image_path is null
       and t.image_path is not null;
  end if;

  select full_name into _actor from public.profiles where id = auth.uid();
  insert into public.audit_logs (ecosystem_id, actor_id, actor_name, action, target, metadata)
  values (_ecosystem_id, auth.uid(), coalesce(_actor,'Admin'), 'Updated store settings', _row.name,
          jsonb_build_object('voucher', _row.store_voucher_enabled,
                             'retail', _row.store_retail_enabled,
                             'seeded', _seeded));

  return query select _row.store_voucher_enabled, _row.store_retail_enabled,
                      _row.retail_cash_enabled, _row.retail_credit_enabled,
                      _row.retail_pickup_enabled, _row.retail_delivery_enabled,
                      _row.public_storefront_enabled, _seeded;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.update_store_settings(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_store_settings(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean) TO authenticated, service_role;

-- Shops that already run retail inherit the new products and photos without
-- losing a single admin-edited price, stock level or visibility flag.
INSERT INTO public.retail_products
  (ecosystem_id, template_id, name, description, category, brand, variant, size_label, unit,
   image_path, price, wholesale_price, wholesale_min_qty, stock, sku, active, published, public_visible)
SELECT e.id, t.id, t.name, t.description, t.category, t.brand, t.variant, t.size_label,
       t.unit, t.image_path, t.default_price, t.default_wholesale_price, t.wholesale_min_qty,
       0, t.sku, true, false, true
  FROM public.ecosystems e
  CROSS JOIN public.retail_catalog_templates t
 WHERE e.store_retail_enabled
   AND t.active
   AND NOT EXISTS (SELECT 1 FROM public.retail_products p
                    WHERE p.ecosystem_id = e.id AND p.template_id = t.id);

UPDATE public.retail_products p
   SET image_path = t.image_path
  FROM public.retail_catalog_templates t
 WHERE p.template_id = t.id AND p.image_path IS NULL AND t.image_path IS NOT NULL;

-- Customers see the photo, pack details and wholesale offer.
DROP FUNCTION IF EXISTS public.list_retail_products(uuid);
CREATE FUNCTION public.list_retail_products(_ecosystem_id uuid)
RETURNS TABLE(id uuid, name text, description text, image_path text, price numeric,
              stock integer, sold_count integer, public_visible boolean,
              rating_avg numeric, rating_count integer,
              brand text, variant text, size_label text, unit text,
              category text, wholesale_price numeric, wholesale_min_qty integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.description, p.image_path, p.price, p.stock, p.sold_count, p.public_visible,
         coalesce((select round(avg(r.rating)::numeric,2) from public.retail_product_ratings r
                    where r.product_id = p.id), 0)::numeric,
         coalesce((select count(*)::int from public.retail_product_ratings r
                    where r.product_id = p.id), 0),
         p.brand, p.variant, p.size_label, p.unit, p.category,
         p.wholesale_price, p.wholesale_min_qty
    FROM public.retail_products p
   WHERE p.ecosystem_id = _ecosystem_id
     AND p.active AND p.published AND NOT p.archived
     AND (public.has_membership(auth.uid(), _ecosystem_id)
          OR (p.public_visible AND EXISTS (SELECT 1 FROM public.ecosystems e
                WHERE e.id = _ecosystem_id AND e.public_storefront_enabled)))
   ORDER BY p.category NULLS LAST, p.name;
$$;

REVOKE EXECUTE ON FUNCTION public.list_retail_products(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.list_retail_products(uuid) TO anon, authenticated, service_role;
