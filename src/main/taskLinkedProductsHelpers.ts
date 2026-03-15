export type LinkedTaskProduct = {
  id: string
  name: string
  cover: string
  productUrl: string
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

export function normalizeLinkedProducts(value: unknown): LinkedTaskProduct[] {
  const list = Array.isArray(value) ? value : []
  const normalized: LinkedTaskProduct[] = []
  const seen = new Set<string>()

  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = normalizeText(record.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    normalized.push({
      id,
      name: normalizeText(record.name),
      cover: normalizeText(record.cover),
      productUrl: normalizeText(record.productUrl)
    })
  }

  return normalized
}

export function derivePrimaryProductFields(input: {
  linkedProducts: LinkedTaskProduct[]
  fallbackProductId?: string
  fallbackProductName?: string
}): {
  productId: string | undefined
  productName: string | undefined
} {
  const linkedProducts = normalizeLinkedProducts(input.linkedProducts)
  const firstLinkedProduct = linkedProducts[0]
  if (firstLinkedProduct) {
    return {
      productId: firstLinkedProduct.id || undefined,
      productName: firstLinkedProduct.name || undefined
    }
  }

  const fallbackProductId = normalizeText(input.fallbackProductId)
  const fallbackProductName = normalizeText(input.fallbackProductName)
  return {
    productId: fallbackProductId || undefined,
    productName: fallbackProductName || undefined
  }
}
