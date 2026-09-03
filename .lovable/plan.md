# Shop and product image management

## Scope
- Reuse the existing `retail-images` storage bucket, image optimizer/cropper, shop image columns, Retail product `image_path`, and current authorization model.
- Add management UX only; preserve all commerce, wallet, pricing, ranking, order, voucher, and tenant-isolation behavior.

## Changes
1. Add a dedicated **Shop images** section to existing Shop Settings for every managed Universe shop, not only Retail shops. Show current logo and cover, explain where each appears, and provide upload/change/remove actions.
2. Require a live crop step with exact final preview before upload: square for logos, wide for covers, and marketplace-shaped for Retail product photos. Upload only after the owner confirms the crop.
3. Update the existing Retail product editor’s Photo section to use the same crop-confirm flow while retaining its current image preview, replace, remove, and product save behavior.
4. Delete superseded files only after the related settings/product save succeeds; canceling an edit must not change the saved image.
5. Keep voucher products on curated artwork fallback because the voucher model has no seller-controlled image field; do not change voucher financial/data logic.
6. Ensure shop images and Retail product images continue through existing Featured Shops, Top Selling Shops, Top Selling Products, product details, and public storefront rendering, with designed fallbacks for missing images.

## Technical details
- Add a narrowly scoped shop-image update RPC because the existing storefront RPC is Retail-only; authorize only the shop admin or platform owner, validate the shop-specific storage folder, and retain audit logging.
- Reuse existing `retail-images` storage policies; change them only if permission testing proves a gap.
- Add focused tests around crop-confirm state/path handling and image cleanup where practical.

## Verification
- Test create/edit/replace/remove for Retail product photos and shop logo/cover, including crop and final preview.
- Verify authorized persistence and rejected cross-shop writes.
- Verify public image display across discovery/storefront surfaces and graceful fallback behavior.
- Run typecheck, relevant/full tests, and inspect 390px mobile plus desktop layouts. Do not publish.
