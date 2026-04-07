// This utility is no longer used. CustomerReference is displayed
// as plain text and Shopify lookups are handled by the
// shopify-get-order edge function + ShopifyOrderPanel component.
// Kept as a no-op export for any lingering imports.

export function formatCustomerReference(ref: string | null) {
  if (!ref) return null;
  return { isShopify: false, label: ref, url: null };
}
