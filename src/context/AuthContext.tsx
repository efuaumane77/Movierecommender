import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

interface AuthContextValue {
    user: User | null
    session: Session | null
    profile: Profile | null
    loading: boolean
    signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null)
    const [user, setUser] = useState<User | null>(null)
    const [profile, setProfile] = useState<Profile | null>(null)
    const [loading, setLoading] = useState(true)
    const initializedRef = useRef(false)

    useEffect(() => {
        let mounted = true

        async function loadProfile(userId: string) {
            const { data } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single()
            if (mounted && data) {
                setProfile(data as Profile)
            }
        }

        supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
            if (!mounted) return
            setSession(initialSession)
            setUser(initialSession?.user ?? null)
            if (initialSession?.user) {
                loadProfile(initialSession.user.id)
            }
            initializedRef.current = true
            setLoading(false)
        })

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            if (!mounted) return
            setSession(nextSession)
            setUser((prev) => {
                const nextUser = nextSession?.user ?? null
                // Keep the same User object reference if ID hasn't changed so workspace doesn't re-fetch/flicker
                if (prev?.id && nextUser?.id && prev.id === nextUser.id) return prev
                return nextUser
            })

            if (nextSession?.user) {
                loadProfile(nextSession.user.id)
            } else {
                setProfile(null)
            }

            if (!initializedRef.current) {
                initializedRef.current = true
                setLoading(false)
            }
        })

        return () => {
            mounted = false
            subscription.unsubscribe()
        }
    }, [])

    async function signOut() {
        await supabase.auth.signOut()
    }

    return (
        <AuthContext.Provider value={{ user, session, profile, loading, signOut }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
    return ctx
}