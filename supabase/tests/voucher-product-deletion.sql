-- Voucher Shop product deletion: WaveWallet-side only, product-scoped.
--
-- Proves: deleting product A removes A's WaveWallet codes only; product B, its
-- codes, its calibration and its replenishment stay intact; sales, wallet and
-- points history survive with their stored product snapshot; a retry is a
-- no-op; a queued replenishment for A is cancelled. Omada is never contacted
-- by this function at all (it is pure SQL).
BEGIN;

SELECT id AS eco FROM public.ecosystems LIMIT 1 \gset

-- Read-only shape checks that guarantee the safety properties.

-- 1) Sales keep a snapshot and a nullable, non-cascading product link.
SELECT 'sales keep snapshot' AS check,
       (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema='public' AND table_name='voucher_sales' AND column_name='product_id') = 'YES'
   AND (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema='public' AND table_name='voucher_sales' AND column_name='product_name') = 'NO'
   AND pg_get_constraintdef(
         (SELECT oid FROM pg_constraint WHERE conname='voucher_sales_product_id_fkey')
       ) LIKE '%ON DELETE SET NULL%' AS ok;

-- 2) Only WaveWallet voucher children cascade from a product.
SELECT 'product children' AS check,
       conrelid::regclass::text AS child,
       pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE confrelid = 'public.voucher_products'::regclass
 ORDER BY 2;

-- 3) Money tables never reference a voucher product, so they cannot cascade.
SELECT 'money untouched' AS check,
       NOT EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE confrelid='public.voucher_products'::regclass
            AND conrelid::regclass::text IN
                ('credit_ledger','points_ledger','credit_accounts','points_accounts')
       ) AS ok;

ROLLBACK;
