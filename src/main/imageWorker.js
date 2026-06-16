import { parentPort } from 'worker_threads'
import sharp from 'sharp'
import fs from 'fs-extra'

parentPort.on('message', async ({ id, buffer, imgPath, thumbPath }) => {
  let imgWritten = false
  let thumbWritten = false
  try {
    // 1. Save original image
    await fs.writeFile(imgPath, buffer)
    imgWritten = true

    // 2. Save standard thumbnail (200px)
    await sharp(buffer)
      .resize(200, 200, { fit: 'inside' })
      .toFile(thumbPath)
    thumbWritten = true

    // 3. Generate mini-thumbnail Base64 (100px) for instant loading
    const miniBuffer = await sharp(buffer)
      .resize(100) // Fixed width 100px is enough for preview
      .webp({ quality: 80 }) // WebP is smaller than PNG for base64
      .toBuffer()

    const base64 = `data:image/webp;base64,${miniBuffer.toString('base64')}`

    parentPort.postMessage({ id, success: true, base64 })
  } catch (err) {
    // Clean up orphan files on partial failure
    if (thumbWritten) {
      try { await fs.unlink(thumbPath) } catch { /* ignore */ }
    }
    if (imgWritten) {
      try { await fs.unlink(imgPath) } catch { /* ignore */ }
    }
    parentPort.postMessage({ id, success: false, error: err.message })
  }
})
