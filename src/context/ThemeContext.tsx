import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type ThemeMode = 'dark' | 'light'

export interface AppPreferences {
    theme: ThemeMode
    showAccountSuggestions: boolean
    compactFeed: boolean
    reducedMotion: boolean
}

const STORAGE_KEY = 'cinerate_preferences_v1'

const DEFAULT_PREFS: AppPreferences = {
    theme: 'dark',
    showAccountSuggestions: true,
    compactFeed: false,
    reducedMotion: false,
}

function readStoredPreferences(): AppPreferences {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return DEFAULT_PREFS
        return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<AppPreferences>) }
    } catch {
        return DEFAULT_PREFS
    }
}

interface ThemeContextValue {
    prefs: AppPreferences
    isLight: boolean
    setTheme: (theme: ThemeMode) => void
    toggleTheme: () => void
    updatePref: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void
    resetPreferences: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [prefs, setPrefs] = useState<AppPreferences>(() => readStoredPreferences())

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
        } catch {
            // Ignore storage quota errors
        }

        const root = document.documentElement
        if (prefs.theme === 'light') {
            root.classList.add('light-mode')
            root.classList.remove('dark-mode')
        } else {
            root.classList.add('dark-mode')
            root.classList.remove('light-mode')
        }

        if (prefs.reducedMotion) {
            root.classList.add('reduce-motion')
        } else {
            root.classList.remove('reduce-motion')
        }
    }, [prefs])

    const setTheme = useCallback((theme: ThemeMode) => {
        setPrefs((prev) => ({ ...prev, theme }))
    }, [])

    const toggleTheme = useCallback(() => {
        setPrefs((prev) => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))
    }, [])

    const updatePref = useCallback(
        <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => {
            setPrefs((prev) => ({ ...prev, [key]: value }))
        },
        []
    )

    const resetPreferences = useCallback(() => {
        setPrefs(DEFAULT_PREFS)
    }, [])

    return (
        <ThemeContext.Provider
            value={{
                prefs,
                isLight: prefs.theme === 'light',
                setTheme,
                toggleTheme,
                updatePref,
                resetPreferences,
            }}
        >
            {children}
        </ThemeContext.Provider>
    )
}

export function useTheme() {
    const ctx = useContext(ThemeContext)
    if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
    return ctx
}