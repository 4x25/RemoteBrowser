export interface CaptureSize {
  width: number
  height: number
}

export interface EncodedImage {
  data: string
  mimeType: string
}

export interface DecodedImageSize {
  width: number
  height: number
}

const MAX_CAPTURE_WIDTH = 1440
const MAX_CAPTURE_HEIGHT = 900

export function computeCaptureSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio = window.devicePixelRatio || 1,
): CaptureSize {
  const safeWidth = Number.isFinite(cssWidth) ? Math.max(1, cssWidth) : 1
  const safeHeight = Number.isFinite(cssHeight) ? Math.max(1, cssHeight) : 1
  const safeDpr = Number.isFinite(devicePixelRatio)
    ? Math.max(1, devicePixelRatio)
    : 1

  return {
    width: Math.min(MAX_CAPTURE_WIDTH, Math.round(safeWidth * safeDpr)),
    height: Math.min(MAX_CAPTURE_HEIGHT, Math.round(safeHeight * safeDpr)),
  }
}

export function base64ToBlob(image: EncodedImage): Blob {
  const binary = atob(image.data)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: image.mimeType })
}

export async function waitForImageDecode(url: string): Promise<DecodedImageSize> {
  const image = new Image()
  image.src = url

  if (typeof image.decode === 'function') {
    await image.decode()
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    }
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('截图解码失败'))
  })

  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  }
}
