type AccountLike = {
  id?: string
}

type ProductLike = {
  id?: string
  name?: string
  cover?: string
  productUrl?: string
}

export type SelectedWorkshopProduct = {
  id: string
  name: string
  cover: string
  productUrl: string
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

export function resolveWorkshopAccountId(input: {
  accounts: AccountLike[]
  currentAccountId?: string | null
  preferredAccountId?: string | null
}): string {
  const accounts = Array.isArray(input.accounts) ? input.accounts : []
  const accountIds = new Set(
    accounts
      .map((account) => normalizeText(account?.id))
      .filter(Boolean)
  )

  const currentAccountId = normalizeText(input.currentAccountId)
  if (currentAccountId && accountIds.has(currentAccountId)) return currentAccountId

  const preferredAccountId = normalizeText(input.preferredAccountId)
  if (preferredAccountId && accountIds.has(preferredAccountId)) return preferredAccountId

  return normalizeText(accounts[0]?.id)
}

export function buildSelectedWorkshopProducts(input: {
  allProducts: ProductLike[]
  selectedProductIds: string[]
}): SelectedWorkshopProduct[] {
  const allProducts = Array.isArray(input.allProducts) ? input.allProducts : []
  const selectedProductIds = Array.isArray(input.selectedProductIds) ? input.selectedProductIds : []

  const productById = new Map<string, SelectedWorkshopProduct>()
  for (const product of allProducts) {
    const id = normalizeText(product?.id)
    if (!id || productById.has(id)) continue
    productById.set(id, {
      id,
      name: normalizeText(product?.name),
      cover: normalizeText(product?.cover),
      productUrl: ''
    })
  }

  const seen = new Set<string>()
  const selectedProducts: SelectedWorkshopProduct[] = []
  for (const rawId of selectedProductIds) {
    const id = normalizeText(rawId)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const product = productById.get(id)
    if (!product) continue
    selectedProducts.push(product)
  }

  return selectedProducts
}
