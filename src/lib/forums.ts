export interface GenreForum {
    slug: string
    name: string
    tagline: string
    emoji: string
    accent: string
}

export const GENRE_FORUMS: GenreForum[] = [
    {
        slug: 'horror',
        name: 'Horror & Slashers',
        tagline: 'Psychological dread, cult classics & late-night scares',
        emoji: '🔪',
        accent: 'from-red-500 to-orange-500',
    },
    {
        slug: 'superheroes',
        name: 'Superheroes & Comics',
        tagline: 'MCU, DCU, multiverse theories & Easter eggs',
        emoji: '🦸',
        accent: 'from-[#FF6B4A] to-[#FF9F43]',
    },
    {
        slug: 'scifi',
        name: 'Sci-Fi & Cyberpunk',
        tagline: 'Space epics, dystopias & mind-bending time loops',
        emoji: '🚀',
        accent: 'from-cyan-500 to-blue-500',
    },
    {
        slug: 'thriller',
        name: 'Thrillers & Mystery',
        tagline: 'Plot twists, neo-noir & whodunits',
        emoji: '🕵️',
        accent: 'from-amber-500 to-yellow-500',
    },
    {
        slug: 'anime',
        name: 'Anime & Animation',
        tagline: 'Seasonal drops, shonen arcs & studio films',
        emoji: '⚡',
        accent: 'from-purple-500 to-pink-500',
    },
    {
        slug: 'drama',
        name: 'Prestige Drama & Indie',
        tagline: 'A24 gems, Oscar contenders & director breakdowns',
        emoji: '🎬',
        accent: 'from-emerald-500 to-teal-500',
    },
]

const JOINED_FORUMS_KEY = 'cinerate_joined_forums'
const DEFAULT_JOINED = ['horror', 'superheroes']

export function readJoinedForumSlugs(): string[] {
    try {
        const raw = localStorage.getItem(JOINED_FORUMS_KEY)
        if (!raw) return DEFAULT_JOINED
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : DEFAULT_JOINED
    } catch {
        return DEFAULT_JOINED
    }
}

export function writeJoinedForumSlugs(slugs: string[]) {
    try {
        localStorage.setItem(JOINED_FORUMS_KEY, JSON.stringify(slugs))
    } catch {
        // ignore
    }
}