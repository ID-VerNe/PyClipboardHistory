import { parentPort } from 'worker_threads'
import sharp from 'sharp'
import fs from 'fs-extra'
import crypto from 'crypto'

// Serialize work so concurrent sharp pipelines don't pile up.
let queue = Promise.resolve()

async function processOne({ id, bitmap, width, height, imgPath, thumbPath }) {
  let imgWritten = false
  let thumbWritten = false
  try {
    // bitmap is BGRA from Electron's nativeImage.getBitmap(). sharp raw expects RGBA.
    // Swap channels in place (33MB ≈ 10-30ms in worker, not main thread).
    for (let i = 0; i < bitmap.length; i += 4) {
      const b = bitmap[i]
      bitmap[i] = bitmap[i + 2]
      bitmap[i + 2] = b
    }

    const hash = crypto.createHash('md5').update(bitmap).digest('hex')

    // Single decode, two outputs via clone(). Full-res PNG for fidelity, WebP thumbnail.
    const pipeline = sharp(bitmap, { raw: { width, height, channels: 4 } }).rotate()
    await Promise.all([
      pipeline.clone().png().toFile(imgPath).then(() => { imgWritten = true }),
      pipeline.clone()
        .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(thumbPath)
        .then(() => { thumbWritten = true })
    ])

    parentPort.postMessage({ id, success: true, hash, imgPath, thumbPath })
  } catch (err) {
    if (thumbWritten) { try { await fs.unlink(thumbPath) } catch {} }
    if (imgWritten) { try { await fs.unlink(imgPath) } catch {} }
    parentPort.postMessage({ id, success: false, error: err.message })
  }
}

parentPort.on('message', (msg) => {
  queue = queue.then(() => processOne(msg)).catch((err) => {
    console.error('imageWorker queue error:', err)
  })
})
