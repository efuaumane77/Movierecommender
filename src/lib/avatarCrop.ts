export interface CropTransform {
    zoom: number // 1 to 3
    offsetX: number // normalized pan X (-1 to 1)
    offsetY: number // normalized pan Y (-1 to 1)
}

export async function fileToDataUrl(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) {
        throw new Error('Please choose an image file (JPG, PNG, or WebP).')
    }
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read that image file.'))
        reader.readAsDataURL(file)
    })
}

export async function renderCroppedAvatar(
    imageSrc: string,
    transform: CropTransform = { zoom: 1, offsetX: 0, offsetY: 0 },
    outputSize = 400
): Promise<string> {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.crossOrigin = 'anonymous'
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('Could not decode image for cropping.'))
        el.src = imageSrc
    })

    const naturalW = img.naturalWidth || img.width
    const naturalH = img.naturalHeight || img.height
    const baseSide = Math.min(naturalW, naturalH)

    const zoom = Math.max(1, Math.min(3, transform.zoom))
    const cropSide = baseSide / zoom

    // Maximum travel from center so the crop box never leaves image bounds
    const maxTravelX = Math.max(0, (naturalW - cropSide) / 2)
    const maxTravelY = Math.max(0, (naturalH - cropSide) / 2)

    const centerX = naturalW / 2 - transform.offsetX * maxTravelX
    const centerY = naturalH / 2 - transform.offsetY * maxTravelY

    const sx = Math.max(0, Math.min(naturalW - cropSide, centerX - cropSide / 2))
    const sy = Math.max(0, Math.min(naturalH - cropSide, centerY - cropSide / 2))

    const canvas = document.createElement('canvas')
    canvas.width = outputSize
    canvas.height = outputSize

    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Canvas is not available in this browser.')
    }

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, cropSide, cropSide, 0, 0, outputSize, outputSize)

    return canvas.toDataURL('image/jpeg', 0.88)
}