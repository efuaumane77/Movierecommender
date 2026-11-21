export function sanitizeAvatarUrl(raw: string | null | undefined): string | null {
    if (!raw) return null
    const trimmed = raw.trim()
    if (!trimmed) return null

    if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
        return trimmed
    }

    try {
        const parsed = new URL(trimmed)
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            return parsed.toString()
        }
        return null
    } catch {
        return null
    }
}

export function clampText(value: string, maxLength: number): string {
    return value.trim().slice(0, maxLength)
}

export function clampRating(value: number | null): number | null {
    if (value === null || Number.isNaN(value)) return null
    const clamped = Math.max(0, Math.min(5, value))
    return Math.round(clamped * 2) / 2
}

export function normalizeUsername(raw: string): string {
    return raw
        .trim()
        .replace(/^@+/, '')
        .replace(/[^a-zA-Z0-9._]/g, '')
}

export interface PasswordStrengthResult {
    hasMinLength: boolean
    hasLetter: boolean
    hasNumber: boolean
    hasSymbol: boolean
    isStrong: boolean
}

export function checkPasswordStrength(password: string): PasswordStrengthResult {
    const hasMinLength = password.length >= 8
    const hasLetter = /[a-zA-Z]/.test(password)
    const hasNumber = /\d/.test(password)
    const hasSymbol = /[^a-zA-Z0-9]/.test(password)

    return {
        hasMinLength,
        hasLetter,
        hasNumber,
        hasSymbol,
        isStrong: hasMinLength && hasLetter && hasNumber && hasSymbol,
    }
}