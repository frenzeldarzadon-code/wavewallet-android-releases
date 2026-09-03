ALTER TABLE public.retail_products
  ADD CONSTRAINT retail_products_wholesale_price_check CHECK (wholesale_price >= 0),
  ADD CONSTRAINT retail_products_wholesale_min_qty_check CHECK (wholesale_min_qty >= 0);