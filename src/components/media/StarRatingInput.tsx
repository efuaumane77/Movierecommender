import { useState } from 'react'
import { Star } from 'lucide-react'

interface StarRatingInputProps {
    value: number
    onChange: (nextValue: number) => void
    size?: 'sm' | 'md'
}

export function StarRatingInput({ value, onChange, size = 'md' }: StarRatingInputProps) {
    const [hoverValue, setHoverValue] = useState<number | null>(null)
    const activeValue = hoverValue ?? value
    const iconClass = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6'

    function handleSelect(next: number) {
        onChange(value === next ? 0 : next)
    }

    return (
        <div
            className="inline-flex items-center gap-1 select-none"
            onMouseLeave={() => setHoverValue(null)}
        >
            {[1, 2, 3, 4, 5].map((starIndex) => {
                const halfVal = starIndex - 0.5
                const fullVal = starIndex
                const showFull = activeValue >= fullVal
                const showHalf = !showFull && activeValue >= halfVal

                return (
                    <div key={starIndex} className="relative inline-flex items-center justify-center p-0.5">
                        {/* Base empty star */}
                        <Star className={`${iconClass} text-zinc-600 transition-colors`} />

                        {/* Half-filled star overlay */}
                        {showHalf && (
                            <Star
                                className={`${iconClass} text-[#FF9F43] fill-[#FF9F43] absolute pointer-events-none transition-colors`}
                                style={{ clipPath: 'inset(0 50% 0 0)' }}
                            />
                        )}

                        {/* Full-filled star overlay */}
                        {showFull && (
                            <Star
                                className={`${iconClass} text-[#FF9F43] fill-[#FF9F43] absolute pointer-events-none transition-colors`}
                            />
                        )}

                        {/* Left half button (e.g. 3.5) */}
                        <button
                            type="button"
                            aria-label={`Rate ${halfVal} out of 5 stars`}
                            onMouseEnter={() => setHoverValue(halfVal)}
                            onClick={() => handleSelect(halfVal)}
                            className="absolute inset-y-0 left-0 w-1/2 cursor-pointer focus:outline-none"
                        />

                        {/* Right half button (e.g. 4) */}
                        <button
                            type="button"
                            aria-label={`Rate ${fullVal} out of 5 stars`}
                            onMouseEnter={() => setHoverValue(fullVal)}
                            onClick={() => handleSelect(fullVal)}
                            className="absolute inset-y-0 right-0 w-1/2 cursor-pointer focus:outline-none"
                        />
                    </div>
                )
            })}

            {value > 0 && (
                <span className="text-xs font-semibold text-zinc-400 ml-2 tabular-nums">
                    {value}/5
                </span>
            )}
        </div>
    )
}