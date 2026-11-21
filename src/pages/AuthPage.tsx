import { useEffect, useState } from 'react'
import {
    Film,
    Check,
    X,
    Eye,
    EyeOff,
    Loader2,
    ShieldCheck,
    AlertCircle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { checkPasswordStrength, normalizeUsername } from '../lib/security'

type AuthMode = 'signin' | 'signup'

export function AuthPage() {
    const [mode, setMode] = useState<AuthMode>('signin')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [username, setUsername] = useState('')

    // Username availability state during sign-up
    const [checkingUsername, setCheckingUsername] = useState(false)
    const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)

    const [submitting, setSubmitting] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [infoMessage, setInfoMessage] = useState<string | null>(null)

    const cleanUsername = normalizeUsername(username)
    const cleanEmail = email.trim().toLowerCase()
    const strength = checkPasswordStrength(password)
    const passedCount = [
        strength.hasMinLength,
        strength.hasLetter,
        strength.hasNumber,
        strength.hasSymbol,
    ].filter(Boolean).length

    useEffect(() => {
        if (mode !== 'signup' || cleanUsername.length < 3) return

        let cancelled = false
        const timer = setTimeout(async () => {
            setCheckingUsername(true)
            try {
                const { data: rpcAvailable, error: rpcError } = await supabase.rpc(
                    'is_username_available',
                    { candidate: cleanUsername }
                )

                if (!cancelled) {
                    if (!rpcError && typeof rpcAvailable === 'boolean') {
                        setUsernameAvailable(rpcAvailable)
                    } else {
                        const { data: existingRows } = await supabase
                            .from('profiles')
                            .select('id')
                            .ilike('username', cleanUsername)
                            .limit(1)

                        if (!cancelled) {
                            setUsernameAvailable(!existingRows || existingRows.length === 0)
                        }
                    }
                }
            } finally {
                if (!cancelled) setCheckingUsername(false)
            }
        }, 300)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [mode, cleanUsername])

    async function verifyUsernameAvailable(candidate: string): Promise<boolean> {
        const { data: rpcAvailable, error: rpcError } = await supabase.rpc(
            'is_username_available',
            { candidate }
        )
        if (!rpcError && typeof rpcAvailable === 'boolean') {
            return rpcAvailable
        }

        const { data: existingRows } = await supabase
            .from('profiles')
            .select('id')
            .ilike('username', candidate)
            .limit(1)

        return !existingRows || existingRows.length === 0
    }

    async function verifyEmailNotInUse(candidateEmail: string): Promise<boolean> {
        const { data: existsAlready, error } = await supabase.rpc(
            'is_email_registered',
            { candidate_email: candidateEmail }
        )
        if (!error && typeof existsAlready === 'boolean') {
            return !existsAlready
        }
        return true
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setErrorMessage(null)
        setInfoMessage(null)

        if (mode === 'signup') {
            if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
                setErrorMessage('Enter a valid email address.')
                return
            }

            if (cleanUsername.length < 3) {
                setErrorMessage('Username must be at least 3 characters (letters, numbers, . or _).')
                return
            }

            if (!strength.isStrong) {
                setErrorMessage(
                    'Password must be at least 8 characters and include a letter, a number, and a symbol.'
                )
                return
            }

            setSubmitting(true)

            const emailIsFree = await verifyEmailNotInUse(cleanEmail)
            if (!emailIsFree) {
                setSubmitting(false)
                setErrorMessage(
                    'An account with this email already exists. Sign in instead or delete that account first.'
                )
                return
            }

            const usernameIsFree = await verifyUsernameAvailable(cleanUsername)
            if (!usernameIsFree) {
                setSubmitting(false)
                setUsernameAvailable(false)
                setErrorMessage(`The username @${cleanUsername} is already taken. Choose another one.`)
                return
            }

            const { data, error } = await supabase.auth.signUp({
                email: cleanEmail,
                password,
                options: {
                    data: {
                        username: cleanUsername,
                    },
                },
            })

            setSubmitting(false)

            if (error) {
                const msg = error.message.toLowerCase()
                if (msg.includes('rate limit')) {
                    setErrorMessage(
                        'Too many confirmation emails sent recently. Please wait a few minutes.'
                    )
                } else if (msg.includes('already') || msg.includes('registered')) {
                    setErrorMessage('An account with this email already exists.')
                } else if (msg.includes('unique') || msg.includes('duplicate')) {
                    setErrorMessage(`The username @${cleanUsername} is already taken. Choose another one.`)
                } else {
                    setErrorMessage(error.message)
                }
                return
            }

            if (data.user && !data.session) {
                setInfoMessage('Check your email to confirm your account, then sign in!')
            }
            return
        }

        // Sign In
        setSubmitting(true)
        const { error } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
        })
        setSubmitting(false)

        if (error) {
            setErrorMessage(error.message)
        }
    }

    return (
        <div className="min-h-dvh bg-[#0E0E12] text-[#F4F4F6] flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#18181F] border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
                {/* Brand Header */}
                <div className="text-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] flex items-center justify-center mx-auto shadow-lg shadow-[#FF6B4A]/25">
                        <Film className="w-6 h-6 text-white" />
                    </div>
                    <h1 className="text-xl font-bold text-white tracking-tight">Cinerate</h1>
                    <p className="text-xs text-zinc-400">
                        Track what you watch, share reviews, and chat with friends.
                    </p>
                </div>

                {/* Mode Switcher */}
                <div className="grid grid-cols-2 bg-[#14141A] p-1 rounded-xl border border-white/10">
                    <button
                        type="button"
                        onClick={() => {
                            setMode('signin')
                            setErrorMessage(null)
                            setInfoMessage(null)
                        }}
                        className={`py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            mode === 'signin'
                                ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white'
                                : 'text-zinc-400 hover:text-white'
                        }`}
                    >
                        Sign In
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setMode('signup')
                            setErrorMessage(null)
                            setInfoMessage(null)
                        }}
                        className={`py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            mode === 'signup'
                                ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white'
                                : 'text-zinc-400 hover:text-white'
                        }`}
                    >
                        Create Account
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {mode === 'signup' && (
                        <div className="space-y-1.5">
                            <label className="block text-[11px] font-semibold text-zinc-400">
                                Username
                            </label>
                            <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
                  @
                </span>
                                <input
                                    type="text"
                                    required
                                    value={username}
                                    onChange={(e) => {
                                        const next = normalizeUsername(e.target.value)
                                        setUsername(next)
                                        if (next.length < 3) {
                                            setUsernameAvailable(null)
                                            setCheckingUsername(false)
                                        }
                                    }}
                                    placeholder="username"
                                    maxLength={24}
                                    className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl pl-8 pr-9 py-2.5 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none"
                                />
                                {cleanUsername.length >= 3 && (
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {checkingUsername ? (
                        <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
                    ) : usernameAvailable === true ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                    ) : usernameAvailable === false ? (
                        <X className="w-4 h-4 text-red-400" />
                    ) : null}
                  </span>
                                )}
                            </div>

                            {cleanUsername.length >= 3 && !checkingUsername && usernameAvailable === false && (
                                <p className="text-[11px] text-red-400 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3 shrink-0" />
                                    <span>@{cleanUsername} is already taken.</span>
                                </p>
                            )}
                            {cleanUsername.length >= 3 && !checkingUsername && usernameAvailable === true && (
                                <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                                    <Check className="w-3 h-3 shrink-0" />
                                    <span>@{cleanUsername} is available!</span>
                                </p>
                            )}
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <label className="block text-[11px] font-semibold text-zinc-400">Email</label>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="block text-[11px] font-semibold text-zinc-400">Password</label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={
                                    mode === 'signup' ? 'Create a strong password' : 'Enter your password'
                                }
                                className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl pl-3.5 pr-10 py-2.5 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((s) => !s)}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
                            >
                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>

                        {/* Live Password Strength Meter & Checklist on Sign Up */}
                        {mode === 'signup' && (
                            <div className="mt-2 bg-[#14141A] border border-white/10 rounded-xl p-3 space-y-2.5">
                                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#FF9F43]" /> Password Strength
                  </span>
                                    <span
                                        className={`text-[11px] font-bold ${
                                            passedCount === 4
                                                ? 'text-emerald-400'
                                                : passedCount >= 2
                                                    ? 'text-[#FF9F43]'
                                                    : 'text-zinc-400'
                                        }`}
                                    >
                    {passedCount === 4
                        ? 'Strong'
                        : passedCount >= 2
                            ? 'Medium'
                            : 'Weak'}
                  </span>
                                </div>

                                {/* 4-segment progress bar */}
                                <div className="grid grid-cols-4 gap-1.5">
                                    {[1, 2, 3, 4].map((step) => (
                                        <div
                                            key={step}
                                            className={`h-1.5 rounded-full transition-colors ${
                                                passedCount >= step
                                                    ? passedCount === 4
                                                        ? 'bg-emerald-400'
                                                        : 'bg-[#FF9F43]'
                                                    : 'bg-[#22222C]'
                                            }`}
                                        />
                                    ))}
                                </div>

                                <ul className="space-y-1 text-[11px]">
                                    <li
                                        className={`flex items-center gap-1.5 ${
                                            strength.hasMinLength ? 'text-emerald-400' : 'text-zinc-400'
                                        }`}
                                    >
                                        {strength.hasMinLength ? (
                                            <Check className="w-3 h-3 shrink-0" />
                                        ) : (
                                            <X className="w-3 h-3 shrink-0 text-zinc-500" />
                                        )}
                                        <span>At least 8 characters</span>
                                    </li>
                                    <li
                                        className={`flex items-center gap-1.5 ${
                                            strength.hasLetter ? 'text-emerald-400' : 'text-zinc-400'
                                        }`}
                                    >
                                        {strength.hasLetter ? (
                                            <Check className="w-3 h-3 shrink-0" />
                                        ) : (
                                            <X className="w-3 h-3 shrink-0 text-zinc-500" />
                                        )}
                                        <span>Contains a letter (a–z, A–Z)</span>
                                    </li>
                                    <li
                                        className={`flex items-center gap-1.5 ${
                                            strength.hasNumber ? 'text-emerald-400' : 'text-zinc-400'
                                        }`}
                                    >
                                        {strength.hasNumber ? (
                                            <Check className="w-3 h-3 shrink-0" />
                                        ) : (
                                            <X className="w-3 h-3 shrink-0 text-zinc-500" />
                                        )}
                                        <span>Contains a number (0–9)</span>
                                    </li>
                                    <li
                                        className={`flex items-center gap-1.5 ${
                                            strength.hasSymbol ? 'text-emerald-400' : 'text-zinc-400'
                                        }`}
                                    >
                                        {strength.hasSymbol ? (
                                            <Check className="w-3 h-3 shrink-0" />
                                        ) : (
                                            <X className="w-3 h-3 shrink-0 text-zinc-500" />
                                        )}
                                        <span>Contains a symbol (!@#$%^&*...)</span>
                                    </li>
                                </ul>
                            </div>
                        )}
                    </div>

                    {errorMessage && (
                        <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-300">
                            {errorMessage}
                        </div>
                    )}

                    {infoMessage && (
                        <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300">
                            {infoMessage}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={
                            submitting ||
                            (mode === 'signup' &&
                                (!strength.isStrong ||
                                    cleanUsername.length < 3 ||
                                    usernameAvailable === false ||
                                    checkingUsername))
                        }
                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs sm:text-sm font-bold shadow-lg shadow-[#FF6B4A]/20 hover:opacity-95 transition disabled:opacity-45 cursor-pointer"
                    >
                        {submitting
                            ? mode === 'signup'
                                ? 'Creating Account...'
                                : 'Signing In...'
                            : mode === 'signup'
                                ? 'Create Account'
                                : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    )
}