type ProductLike = {
  id?: string
  name?: string
  cover?: string
  price?: string
  productUrl?: string
  accountId?: string
}

export type CmsSelectableProduct = {
  id: string
  name: string
  cover: string
  price: string
  productUrl: string
  accountId: string
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

export function resolveTaskSelectedProductIds(input: {
  linkedProducts?: ProductLike[] | null
  productId?: string | null
}): string[] {
  const linkedProducts = Array.isArray(input.linkedProducts) ? input.linkedProducts : []
  const seen = new Set<string>()
  const selectedIds: string[] = []

  for (const item of linkedProducts) {
    const id = normalizeText(item?.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    selectedIds.push(id)
  }

  if (selectedIds.length > 0) return selectedIds

  const fallbackProductId = normalizeText(input.productId)
  return fallbackProductId ? [fallbackProductId] : []
}

export function mergeTaskSelectableProducts(input: {
  accountId?: string | null
  products?: ProductLike[] | null
  linkedProducts?: ProductLike[] | null
  productId?: string | null
  productName?: string | null
}): CmsSelectableProduct[] {
  const accountId = normalizeText(input.accountId)
  const products = Array.isArray(input.products) ? input.products : []
  const linkedProducts = Array.isArray(input.linkedProducts) ? input.linkedProducts : []
  const merged = new Map<string, CmsSelectableProduct>()

  const pushProduct = (item: ProductLike | null | undefined, fallback?: { id?: string | null; name?: string | null }): void => {
    const id = normalizeText(item?.id ?? fallback?.id)
    if (!id) return

    const nextProduct: CmsSelectableProduct = {
      id,
      name: normalizeText(item?.name ?? fallback?.name),
      cover: normalizeText(item?.cover),
      price: normalizeText(item?.price),
      // 媒体矩阵与数据工坊都不再依赖商品 URL。
      productUrl: '',
      accountId: normalizeText(item?.accountId) || accountId
    }

    const existing = merged.get(id)
    if (existing) {
      merged.set(id, {
        id,
        name: existing.name || nextProduct.name,
        cover: existing.cover || nextProduct.cover,
        price: existing.price || nextProduct.price,
        productUrl: '',
        accountId: existing.accountId || nextProduct.accountId
      })
      return
    }

    merged.set(id, nextProduct)
  }

  for (const item of linkedProducts) pushProduct(item)
  pushProduct(null, {
    id: input.productId,
    name: input.productName
  })
  for (const item of products) pushProduct(item)

  return Array.from(merged.values())
}

export function formatTaskProductSummary(input: {
  linkedProducts?: ProductLike[] | null
  productName?: string | null
  emptyLabel?: string
}): string {
  const emptyLabel = normalizeText(input.emptyLabel) || '未绑定商品'
  const linkedProducts = Array.isArray(input.linkedProducts) ? input.linkedProducts : []
  const selectedIds = resolveTaskSelectedProductIds({ linkedProducts })

  if (selectedIds.length > 0) {
    const firstLinkedProduct = linkedProducts.find((item) => normalizeText(item?.id) === selectedIds[0])
    const firstLabel =
      normalizeText(firstLinkedProduct?.name) ||
      normalizeText(firstLinkedProduct?.id) ||
      normalizeText(input.productName)

    if (!firstLabel) return emptyLabel
    if (selectedIds.length === 1) return firstLabel
    return `${firstLabel} +${selectedIds.length - 1}`
  }

  const fallbackProductName = normalizeText(input.productName)
  return fallbackProductName || emptyLabel
}
