import { app } from 'electron'
import { randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import { extname, join } from 'path'
import sharp from 'sharp'

type OutputFormat = 'jpeg' | 'png' | 'webp'

function normalizeExtLower(filePath: string): string {
  return extname(String(filePath ?? '')).toLowerCase()
}

function resolveOutputFormat(filePath: string): OutputFormat {
  const extLower = normalizeExtLower(filePath)
  if (extLower === '.jpg' || extLower === '.jpeg') return 'jpeg'
  if (extLower === '.webp') return 'webp'
  return 'png'
}

function resolveOutputExt(format: OutputFormat): string {
  if (format === 'jpeg') return '.jpg'
  if (format === 'webp') return '.webp'
  return '.png'
}

/** 随机裁切 1-3% 边缘 */
function computeCropMargin(value: number): number {
  const percent = 0.01 + Math.random() * 0.02 // 1% ~ 3%
  const margin = Math.max(0, Math.floor(value * percent))
  if (margin <= 0) return 0
  if (margin * 2 >= value) return 0
  return Math.max(1, margin)
}

/** 亮度 ±1% */
function jitterBrightnessFactor(): number {
  const delta = Math.random() * 0.02 - 0.01
  const next = 1 + delta
  return Math.max(0.98, Math.min(1.02, next))
}

/** 饱和度 ±5% */
function jitterSaturationFactor(): number {
  return 0.95 + Math.random() * 0.10 // 0.95 ~ 1.05
}

/** 微旋转 0.5-2 度（随机正负） */
function jitterRotationAngle(): number {
  const angle = 0.5 + Math.random() * 1.5 // 0.5 ~ 2.0
  return Math.random() < 0.5 ? -angle : angle
}

/** 输出质量随机 85-95 */
function jitterQuality(): number {
  return Math.floor(Math.random() * 11) + 85 // 85 ~ 95
}

export async function mutateImage(filePath: string): Promise<string> {
  const inputPath = String(filePath ?? '').trim()
  if (!inputPath) throw new Error('[Mutator] filePath is required.')

  const root = app.getPath('userData')
  const outDir = join(root, 'generated_assets')
  await mkdir(outDir, { recursive: true })

  const format = resolveOutputFormat(inputPath)
  const outputName = `${Date.now()}_${randomUUID()}${resolveOutputExt(format)}`
  const outputPath = join(outDir, outputName)

  // 1. EXIF 自动矫正
  let pipeline = sharp(inputPath, { failOn: 'none' }).rotate()
  const meta = await pipeline.metadata()
  const width = typeof meta.width === 'number' ? meta.width : 0
  const height = typeof meta.height === 'number' ? meta.height : 0

  // 2. 随机裁切 1-3% 边缘
  const left = computeCropMargin(width)
  const top = computeCropMargin(height)
  const cropWidth = width > 0 ? width - left * 2 : 0
  const cropHeight = height > 0 ? height - top * 2 : 0

  if (left > 0 && top > 0 && cropWidth > 0 && cropHeight > 0) {
    pipeline = pipeline.extract({ left, top, width: cropWidth, height: cropHeight })
  }

  // 3. 微旋转 0.5-2 度（裁切后执行，减少角部伪影）
  const rotBg = format === 'jpeg'
    ? { r: 255, g: 255, b: 255 }
    : { r: 0, g: 0, b: 0, alpha: 0 }
  pipeline = pipeline.rotate(jitterRotationAngle(), { background: rotBg })

  // 4. 亮度 ±1% + 饱和度 ±5%
  pipeline = pipeline.modulate({
    brightness: jitterBrightnessFactor(),
    saturation: jitterSaturationFactor()
  })

  // 5. 输出（质量随机 85-95，EXIF 默认不保留）
  const quality = jitterQuality()
  if (format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true })
  } else if (format === 'webp') {
    pipeline = pipeline.webp({ quality })
  } else {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
  }

  await pipeline.toFile(outputPath)
  return outputPath
}
