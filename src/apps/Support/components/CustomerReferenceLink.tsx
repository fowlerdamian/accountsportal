// CustomerReference is now displayed as plain text.
// Shopify order data is loaded via its own panel (ShopifyOrderPanel).
// This file is kept minimal for backward compatibility.

interface Props {
  reference: string | null;
  className?: string;
}

export function CustomerReferenceLink({ reference, className }: Props) {
  if (!reference) return null;
  return <span className={className}>{reference}</span>;
}
