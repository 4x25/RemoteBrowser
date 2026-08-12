export interface CacheableFrame {
  pageId: number
  objectUrl: string
}

export class FrameCache<Frame extends CacheableFrame> {
  private readonly frames = new Map<number, Frame>()

  constructor(
    private readonly revokeObjectUrl: (objectUrl: string) => void = (objectUrl) =>
      URL.revokeObjectURL(objectUrl),
  ) {}

  get(pageId: number): Frame | null {
    return this.frames.get(pageId) ?? null
  }

  replace(frame: Frame): void {
    const previous = this.frames.get(frame.pageId)
    this.frames.set(frame.pageId, frame)
    if (previous && previous.objectUrl !== frame.objectUrl) {
      this.revokeIfUnused(previous.objectUrl)
    }
  }

  delete(pageId: number): void {
    const frame = this.frames.get(pageId)
    if (!frame) return
    this.frames.delete(pageId)
    this.revokeIfUnused(frame.objectUrl)
  }

  retain(pageIds: Iterable<number>): void {
    const retained = new Set(pageIds)
    for (const pageId of this.frames.keys()) {
      if (!retained.has(pageId)) this.delete(pageId)
    }
  }

  clear(): void {
    const objectUrls = new Set(
      Array.from(this.frames.values(), (frame) => frame.objectUrl),
    )
    this.frames.clear()
    for (const objectUrl of objectUrls) this.revokeObjectUrl(objectUrl)
  }

  private revokeIfUnused(objectUrl: string): void {
    const stillUsed = Array.from(this.frames.values()).some(
      (frame) => frame.objectUrl === objectUrl,
    )
    if (!stillUsed) this.revokeObjectUrl(objectUrl)
  }
}
