import { useState, type ComponentType } from 'react'
import {
    Sun,
    Moon,
    User,
    Lock,
    Globe,
    Sliders,
    Download,
    LogOut,
    Check,
    Search,
    Sparkles,
    ShieldCheck,
    KeyRound,
    Mail,
    Trash2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { checkPasswordStrength, clampText } from '../lib/security'
import type { MediaLog } from '../types/database'

const AVAILABLE_INTERESTS = [
    'Superheroes',
    'Horror',
    'Sci-Fi',
    'Thrillers',
    'Anime',
    'Drama',
    'Action',
    'Comedy',
    'Mystery',
    'Indie',
]

type SettingsSection = 'appearance' | 'profile' | 'privacy' | 'security' | 'account'

interface NavItemConfig {
    id: SettingsSection
    label: string
    subtitle: string
    icon: ComponentType<{ className?: string }>
}

interface SettingsPageProps {
    myLogs: MediaLog[]
    onProfileUpdated?: () => void
}

export function SettingsPage({ myLogs, onProfileUpdated }: SettingsPageProps) {
    const { user, profile, signOut } = useAuth()
    const { prefs, setTheme, updatePref, resetPreferences } = useTheme()

    const [activeSection, setActiveSection] = useState<SettingsSection>('appearance')
    const [sectionFilter, setSectionFilter] = useState('')

    // Profile fields initialized directly from profile
    const [displayName, setDisplayName] = useState(() => profile?.display_name ?? '')
    const [pronouns, setPronouns] = useState(() => profile?.pronouns ?? '')
    const [bio, setBio] = useState(() => profile?.bio ?? '')
    const [interests, setInterests] = useState<string[]>(() => profile?.interests ?? [])
    const [watchedVisibility, setWatchedVisibility] = useState<'everyone' | 'followers'>(
        () => profile?.watched_visibility ?? 'everyone'
    )

    // Security: email & password update state
    const [newEmail, setNewEmail] = useState('')
    const [updatingEmail, setUpdatingEmail] = useState(false)
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [updatingPassword, setUpdatingPassword] = useState(false)
    const [signingOutGlobal, setSigningOutGlobal] = useState(false)

    // Account deletion state
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
    const [deleteConfirmText, setDeleteConfirmText] = useState('')
    const [deletingAccount, setDeletingAccount] = useState(false)

    const [saving, setSaving] = useState(false)
    const [statusMessage, setStatusMessage] = useState<string | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    function syncProfileDraftFromCurrent() {
        setDisplayName(profile?.display_name ?? '')
        setPronouns(profile?.pronouns ?? '')
        setBio(profile?.bio ?? '')
        setInterests(profile?.interests ?? [])
        setWatchedVisibility(profile?.watched_visibility ?? 'everyone')
    }

    function toggleInterest(tag: string) {
        setInterests((prev) =>
            prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
        )
    }

    async function saveProfileSettings(e: React.FormEvent) {
        e.preventDefault()
        if (!user) return
        setSaving(true)
        setStatusMessage(null)
        setErrorMessage(null)

        const cleanDisplayName = clampText(displayName, 60) || null
        const cleanPronouns = clampText(pronouns, 24) || null
        const cleanBio = clampText(bio, 240) || null

        const { error } = await supabase
            .from('profiles')
            .update({
                display_name: cleanDisplayName,
                pronouns: cleanPronouns,
                bio: cleanBio,
                interests,
                watched_visibility: watchedVisibility,
            })
            .eq('id', user.id)

        setSaving(false)

        if (error) {
            setErrorMessage(error.message)
            return
        }

        setStatusMessage('Settings saved to your profile.')
        onProfileUpdated?.()
        setTimeout(() => setStatusMessage(null), 2500)
    }

    async function handleVisibilityChange(nextVis: 'everyone' | 'followers') {
        setWatchedVisibility(nextVis)
        if (!user) return
        setStatusMessage(null)
        setErrorMessage(null)

        const { error } = await supabase
            .from('profiles')
            .update({ watched_visibility: nextVis })
            .eq('id', user.id)

        if (error) {
            setErrorMessage(error.message)
        } else {
            setStatusMessage(
                nextVis === 'followers'
                    ? 'Watched Library set to Followers Only.'
                    : 'Watched Library set to Everyone.'
            )
            onProfileUpdated?.()
            setTimeout(() => setStatusMessage(null), 2500)
        }
    }

    async function handleChangeEmail(e: React.FormEvent) {
        e.preventDefault()
        setStatusMessage(null)
        setErrorMessage(null)

        const trimmedEmail = newEmail.trim().toLowerCase()
        if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            setErrorMessage('Enter a valid email address.')
            return
        }
        if (user?.email && trimmedEmail === user.email.toLowerCase()) {
            setErrorMessage('That is already your current email address.')
            return
        }

        setUpdatingEmail(true)
        const { error } = await supabase.auth.updateUser({ email: trimmedEmail })
        setUpdatingEmail(false)

        if (error) {
            setErrorMessage(error.message)
            return
        }

        setNewEmail('')
        setStatusMessage(
            `Confirmation sent to ${trimmedEmail}. Check your inbox to complete the email change.`
        )
        setTimeout(() => setStatusMessage(null), 4000)
    }

    async function handleChangePassword(e: React.FormEvent) {
        e.preventDefault()
        setStatusMessage(null)
        setErrorMessage(null)

        const strength = checkPasswordStrength(newPassword)
        if (!strength.isStrong) {
            setErrorMessage(
                'Password must be at least 8 characters and include a letter, a number, and a symbol.'
            )
            return
        }
        if (newPassword !== confirmPassword) {
            setErrorMessage('Passwords do not match.')
            return
        }

        setUpdatingPassword(true)
        const { error } = await supabase.auth.updateUser({ password: newPassword })
        setUpdatingPassword(false)

        if (error) {
            setErrorMessage(error.message)
            return
        }

        setNewPassword('')
        setConfirmPassword('')
        setStatusMessage('Password updated successfully.')
        setTimeout(() => setStatusMessage(null), 2500)
    }

    async function handleSignOutAllDevices() {
        setSigningOutGlobal(true)
        setErrorMessage(null)
        const { error } = await supabase.auth.signOut({ scope: 'global' })
        setSigningOutGlobal(false)
        if (error) {
            setErrorMessage(error.message)
            return
        }
        await signOut()
    }

    async function handleDeleteAccount() {
        if (!user || deleteConfirmText !== 'DELETE') return
        setDeletingAccount(true)
        setErrorMessage(null)

        const { error } = await supabase.rpc('delete_own_account')
        if (error) {
            setDeletingAccount(false)
            setErrorMessage(error.message)
            return
        }

        await supabase.auth.signOut({ scope: 'local' })
        await signOut()
    }

    function handleExportLibraryJson() {
        const payload = {
            exportedAt: new Date().toISOString(),
            username: profile?.username ?? null,
            displayName: profile?.display_name ?? null,
            logs: myLogs,
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `cinerate-${profile?.username ?? 'library'}.json`
        link.click()
        URL.revokeObjectURL(url)
        setStatusMessage(`Exported ${myLogs.length} library entries as JSON.`)
        setTimeout(() => setStatusMessage(null), 2500)
    }

    const allNavItems: NavItemConfig[] = [
        {
            id: 'appearance',
            label: 'Appearance & Theme',
            subtitle: 'Light mode, dark mode & motion',
            icon: prefs.theme === 'light' ? Sun : Moon,
        },
        {
            id: 'profile',
            label: 'Edit Profile',
            subtitle: 'Name, pronouns, bio & interests',
            icon: User,
        },
        {
            id: 'privacy',
            label: 'Privacy & Discovery',
            subtitle: 'Watched library & suggestions',
            icon: Lock,
        },
        {
            id: 'security',
            label: 'Security & Sessions',
            subtitle: 'Email, password & sessions',
            icon: ShieldCheck,
        },
        {
            id: 'account',
            label: 'Account & Data',
            subtitle: 'Export logs & session',
            icon: Sliders,
        },
    ]

    const navItems: NavItemConfig[] = allNavItems.filter((item) => {
        if (!sectionFilter.trim()) return true
        const q = sectionFilter.toLowerCase()
        return item.label.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q)
    })

    return (
        <div className="bg-[#18181F] border border-white/10 rounded-2xl overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[540px]">
            {/* Left Settings Navigation Column */}
            <aside className="md:col-span-4 lg:col-span-4 border-b md:border-b-0 md:border-r border-white/10 bg-[#14141A] p-4 space-y-4">
                <div>
                    <h1 className="text-base font-bold text-white">Settings</h1>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                        @{profile?.username ?? 'user'}
                    </p>
                </div>

                <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        type="text"
                        value={sectionFilter}
                        onChange={(e) => setSectionFilter(e.target.value)}
                        placeholder="Search settings..."
                        className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
                    />
                </div>

                <nav className="space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon
                        const active = activeSection === item.id
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    if (item.id === 'profile') {
                                        syncProfileDraftFromCurrent()
                                    }
                                    setActiveSection(item.id)
                                    setStatusMessage(null)
                                    setErrorMessage(null)
                                }}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition cursor-pointer ${
                                    active
                                        ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white shadow-sm'
                                        : 'text-zinc-300 hover:bg-[#22222C]'
                                }`}
                            >
                                <Icon className="w-4 h-4 shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-xs font-bold truncate">{item.label}</p>
                                    <p
                                        className={`text-[10px] truncate ${
                                            active ? 'text-white/85' : 'text-zinc-400'
                                        }`}
                                    >
                                        {item.subtitle}
                                    </p>
                                </div>
                            </button>
                        )
                    })}
                </nav>
            </aside>

            {/* Right Settings Content Pane */}
            <div className="md:col-span-8 lg:col-span-8 p-5 sm:p-6 flex flex-col justify-between space-y-6">
                <div className="space-y-5">
                    {statusMessage && (
                        <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-2">
                            <Check className="w-4 h-4 shrink-0" /> {statusMessage}
                        </div>
                    )}
                    {errorMessage && (
                        <div className="px-3.5 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-semibold">
                            {errorMessage}
                        </div>
                    )}

                    {activeSection === 'appearance' && (
                        <div className="space-y-5">
                            <div>
                                <h2 className="text-base font-bold text-white">Appearance & Theme</h2>
                                <p className="text-xs text-zinc-400 mt-0.5">
                                    Switch between dark cinema mode and bright light mode.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setTheme('dark')}
                                    className={`p-4 rounded-2xl border text-left transition cursor-pointer flex items-start gap-3 ${
                                        prefs.theme === 'dark'
                                            ? 'border-[#FF6B4A] bg-[#FF6B4A]/10'
                                            : 'border-white/10 bg-[#14141A] hover:bg-[#22222C]'
                                    }`}
                                >
                                    <div className="w-9 h-9 rounded-xl bg-[#22222C] flex items-center justify-center shrink-0">
                                        <Moon className="w-4 h-4 text-[#FF9F43]" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-white">Dark Mode</p>
                                        <p className="text-[11px] text-zinc-400 mt-0.5">
                                            Low-glare charcoal surfaces for late-night watching.
                                        </p>
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setTheme('light')}
                                    className={`p-4 rounded-2xl border text-left transition cursor-pointer flex items-start gap-3 ${
                                        prefs.theme === 'light'
                                            ? 'border-[#FF6B4A] bg-[#FF6B4A]/10'
                                            : 'border-white/10 bg-[#14141A] hover:bg-[#22222C]'
                                    }`}
                                >
                                    <div className="w-9 h-9 rounded-xl bg-[#22222C] flex items-center justify-center shrink-0">
                                        <Sun className="w-4 h-4 text-[#FF6B4A]" />
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-white">Light Mode</p>
                                        <p className="text-[11px] text-zinc-400 mt-0.5">
                                            Crisp daylight surfaces with coral & amber accents.
                                        </p>
                                    </div>
                                </button>
                            </div>

                            <div className="divide-y divide-white/10 bg-[#14141A] border border-white/10 rounded-2xl px-4">
                                <label className="py-3.5 flex items-center justify-between gap-4 cursor-pointer">
                                    <div>
                                        <p className="text-xs font-bold text-white">Reduced Motion</p>
                                        <p className="text-[11px] text-zinc-400">
                                            Minimize glide and transition animations across messages and feeds.
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={prefs.reducedMotion}
                                        onChange={(e) => updatePref('reducedMotion', e.target.checked)}
                                        className="w-4 h-4 accent-[#FF6B4A] cursor-pointer"
                                    />
                                </label>

                                <label className="py-3.5 flex items-center justify-between gap-4 cursor-pointer">
                                    <div>
                                        <p className="text-xs font-bold text-white">Show Account Suggestions</p>
                                        <p className="text-[11px] text-zinc-400">
                                            Display suggested people to follow in your right rail.
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={prefs.showAccountSuggestions}
                                        onChange={(e) => updatePref('showAccountSuggestions', e.target.checked)}
                                        className="w-4 h-4 accent-[#FF6B4A] cursor-pointer"
                                    />
                                </label>
                            </div>
                        </div>
                    )}

                    {activeSection === 'profile' && (
                        <form onSubmit={saveProfileSettings} className="space-y-4">
                            <div>
                                <h2 className="text-base font-bold text-white">Edit Profile</h2>
                                <p className="text-xs text-zinc-400 mt-0.5">
                                    Update how your profile appears to friends and mutuals.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                                        Display Name
                                    </label>
                                    <input
                                        type="text"
                                        maxLength={60}
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        placeholder="Display name"
                                        className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                                        Pronouns
                                    </label>
                                    <input
                                        type="text"
                                        maxLength={24}
                                        value={pronouns}
                                        onChange={(e) => setPronouns(e.target.value)}
                                        placeholder="e.g. he/him, she/her, they/them"
                                        className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                                    Bio ({bio.length}/240)
                                </label>
                                <textarea
                                    rows={3}
                                    maxLength={240}
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    placeholder="Tell people what genres, directors, or shows you love..."
                                    className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3 py-2 text-xs text-white focus:outline-none resize-none"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5 flex items-center gap-1">
                                    <Sparkles className="w-3 h-3 text-[#FF9F43]" /> Interests
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    {AVAILABLE_INTERESTS.map((tag) => {
                                        const active = interests.includes(tag)
                                        return (
                                            <button
                                                key={tag}
                                                type="button"
                                                onClick={() => toggleInterest(tag)}
                                                className={`px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${
                                                    active
                                                        ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white'
                                                        : 'bg-[#22222C] text-zinc-300 border border-white/10'
                                                }`}
                                            >
                                                {tag}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            <div className="pt-2 flex justify-end">
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                                >
                                    {saving ? 'Saving...' : 'Save Profile'}
                                </button>
                            </div>
                        </form>
                    )}

                    {activeSection === 'privacy' && (
                        <div className="space-y-4">
                            <div>
                                <h2 className="text-base font-bold text-white">Privacy & Discovery</h2>
                                <p className="text-xs text-zinc-400 mt-0.5">
                                    Control who can view your Watched Library and how discovery works.
                                </p>
                            </div>

                            <div className="bg-[#14141A] border border-white/10 rounded-2xl p-4 space-y-3">
                                <p className="text-xs font-bold text-white">Watched Library Visibility</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    <button
                                        type="button"
                                        onClick={() => handleVisibilityChange('everyone')}
                                        className={`p-3 rounded-xl border text-left transition cursor-pointer flex items-center gap-2.5 ${
                                            watchedVisibility === 'everyone'
                                                ? 'border-[#FF6B4A] bg-[#FF6B4A]/15 text-white'
                                                : 'border-white/10 bg-[#22222C] text-zinc-300'
                                        }`}
                                    >
                                        <Globe className="w-4 h-4 text-emerald-400 shrink-0" />
                                        <div>
                                            <p className="text-xs font-bold">Everyone</p>
                                            <p className="text-[10px] text-zinc-400">Any logged-in member can view</p>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleVisibilityChange('followers')}
                                        className={`p-3 rounded-xl border text-left transition cursor-pointer flex items-center gap-2.5 ${
                                            watchedVisibility === 'followers'
                                                ? 'border-[#FF6B4A] bg-[#FF6B4A]/15 text-white'
                                                : 'border-white/10 bg-[#22222C] text-zinc-300'
                                        }`}
                                    >
                                        <Lock className="w-4 h-4 text-[#FF6B4A] shrink-0" />
                                        <div>
                                            <p className="text-xs font-bold">Followers Only</p>
                                            <p className="text-[10px] text-zinc-400">Only accepted connections can view</p>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSection === 'security' && (
                        <div className="space-y-4">
                            <div>
                                <h2 className="text-base font-bold text-white">Security & Sessions</h2>
                                <p className="text-xs text-zinc-400 mt-0.5">
                                    Signed in as <span className="text-zinc-200 font-semibold">{user?.email}</span>
                                </p>
                            </div>

                            <form
                                onSubmit={handleChangeEmail}
                                className="bg-[#14141A] border border-white/10 rounded-2xl p-4 space-y-3"
                            >
                                <p className="text-xs font-bold text-white flex items-center gap-1.5">
                                    <Mail className="w-3.5 h-3.5 text-[#FF6B4A]" /> Change Email Address
                                </p>
                                <div className="flex flex-col sm:flex-row gap-2.5">
                                    <input
                                        type="email"
                                        value={newEmail}
                                        onChange={(e) => setNewEmail(e.target.value)}
                                        placeholder="New email address"
                                        className="flex-1 bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                                    />
                                    <button
                                        type="submit"
                                        disabled={updatingEmail || !newEmail.trim()}
                                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer shrink-0"
                                    >
                                        {updatingEmail ? 'Updating...' : 'Update Email'}
                                    </button>
                                </div>
                                <p className="text-[11px] text-zinc-400">
                                    A verification link will be sent to confirm your new email address.
                                </p>
                            </form>

                            <form
                                onSubmit={handleChangePassword}
                                className="bg-[#14141A] border border-white/10 rounded-2xl p-4 space-y-3"
                            >
                                <p className="text-xs font-bold text-white flex items-center gap-1.5">
                                    <KeyRound className="w-3.5 h-3.5 text-[#FF9F43]" /> Change Password
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <input
                                        type="password"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="New password (8+ chars, letter, number, symbol)"
                                        className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                                    />
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        placeholder="Confirm new password"
                                        className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                                    />
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={updatingPassword || !newPassword}
                                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                                    >
                                        {updatingPassword ? 'Updating...' : 'Update Password'}
                                    </button>
                                </div>
                            </form>

                            <div className="bg-[#14141A] border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-xs font-bold text-white">Sign Out of All Devices</p>
                                    <p className="text-[11px] text-zinc-400">
                                        Revoke active sessions across other browsers or devices.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    disabled={signingOutGlobal}
                                    onClick={handleSignOutAllDevices}
                                    className="px-3.5 py-2 rounded-xl bg-[#22222C] hover:bg-red-500/20 border border-white/15 text-xs font-semibold text-zinc-200 hover:text-red-300 transition cursor-pointer shrink-0"
                                >
                                    {signingOutGlobal ? 'Signing out...' : 'Sign Out Everywhere'}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeSection === 'account' && (
                        <div className="space-y-4">
                            <div>
                                <h2 className="text-base font-bold text-white">Account & Data</h2>
                                <p className="text-xs text-zinc-400 mt-0.5">
                                    Download a copy of your logged titles and reviews or manage your session.
                                </p>
                            </div>

                            <div className="bg-[#14141A] border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-xs font-bold text-white">Download Library & Reviews</p>
                                    <p className="text-[11px] text-zinc-400">
                                        Export all {myLogs.length} of your tracked titles and reviews as JSON.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleExportLibraryJson}
                                    className="px-3.5 py-2 rounded-xl bg-[#22222C] hover:bg-[#2C2C38] border border-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition cursor-pointer shrink-0"
                                >
                                    <Download className="w-3.5 h-3.5 text-[#FF9F43]" /> Export JSON
                                </button>
                            </div>

                            <div className="bg-[#14141A] border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-xs font-bold text-white">Reset Local Preferences</p>
                                    <p className="text-[11px] text-zinc-400">
                                        Restore theme and motion settings to their defaults.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        resetPreferences()
                                        setStatusMessage('Preferences reset to defaults.')
                                        setTimeout(() => setStatusMessage(null), 2000)
                                    }}
                                    className="px-3.5 py-2 rounded-xl bg-[#22222C] text-xs font-semibold text-zinc-200 hover:text-white transition cursor-pointer shrink-0"
                                >
                                    Reset
                                </button>
                            </div>

                            <div className="bg-[#14141A] border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-xs font-bold text-white">Sign Out</p>
                                    <p className="text-[11px] text-zinc-400">
                                        End your current session on this device.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={signOut}
                                    className="px-3.5 py-2 rounded-xl bg-[#22222C] hover:bg-[#2C2C38] text-xs font-semibold text-zinc-200 hover:text-white flex items-center gap-1.5 transition cursor-pointer shrink-0"
                                >
                                    <LogOut className="w-3.5 h-3.5" /> Sign Out
                                </button>
                            </div>

                            {/* Delete Account Section */}
                            <div className="bg-red-500/10 border border-red-500/25 rounded-2xl p-4 space-y-3">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-xs font-bold text-red-400">Delete Account</p>
                                        <p className="text-[11px] text-zinc-400">
                                            Permanently remove your account, profile, logs, and messages. This email can be used to create a new account afterward.
                                        </p>
                                    </div>
                                    {!confirmDeleteOpen && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setConfirmDeleteOpen(true)
                                                setDeleteConfirmText('')
                                            }}
                                            className="px-3.5 py-2 rounded-xl bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" /> Delete Account
                                        </button>
                                    )}
                                </div>

                                {confirmDeleteOpen && (
                                    <div className="pt-2 border-t border-red-500/20 space-y-2.5">
                                        <p className="text-[11px] text-red-300">
                                            Type <span className="font-bold">DELETE</span> below to permanently delete your account:
                                        </p>
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            <input
                                                type="text"
                                                value={deleteConfirmText}
                                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                                placeholder="Type DELETE"
                                                className="flex-1 bg-[#14141A] border border-red-500/35 focus:border-red-400 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setConfirmDeleteOpen(false)
                                                    setDeleteConfirmText('')
                                                }}
                                                className="px-3 py-2 rounded-xl bg-[#22222C] text-xs font-semibold text-zinc-300 cursor-pointer"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                disabled={deleteConfirmText !== 'DELETE' || deletingAccount}
                                                onClick={handleDeleteAccount}
                                                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold disabled:opacity-40 transition cursor-pointer shrink-0"
                                            >
                                                {deletingAccount ? 'Deleting...' : 'Confirm Delete'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}