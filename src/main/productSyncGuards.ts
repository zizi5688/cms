export const EMPTY_PRODUCT_SYNC_RESULT_MESSAGE =
  '未抓取到有效商品，本次不会覆盖已有商品，请检查小红书商品弹窗后重试。'

export function ensureNonEmptyProductSyncResult<T>(products: T[]): T[] {
  if (Array.isArray(products) && products.length > 0) return products
  throw new Error(EMPTY_PRODUCT_SYNC_RESULT_MESSAGE)
}
