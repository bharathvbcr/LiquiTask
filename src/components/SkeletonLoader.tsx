import React from 'react';

interface SkeletonLoaderProps {
    type?: 'card' | 'column' | 'sidebar';
    count?: number;
}

const SkeletonCard: React.FC = () => (
    <div className="liquid-card rounded-2xl p-5 animate-pulse">
        {/* Priority badge skeleton */}
        <div className="flex justify-between items-center mb-3">
            <div className="h-6 w-20 bg-white/10 rounded-lg"></div>
            <div className="h-5 w-16 bg-white/5 rounded"></div>
        </div>

        {/* Title skeleton */}
        <div className="mb-3">
            <div className="h-5 w-3/4 bg-white/10 rounded mb-2"></div>
            <div className="h-3 w-1/2 bg-white/5 rounded"></div>
        </div>

        {/* Summary skeleton */}
        <div className="bg-black/20 rounded-xl p-3 mb-3">
            <div className="h-3 w-full bg-white/5 rounded mb-2"></div>
            <div className="h-3 w-4/5 bg-white/5 rounded"></div>
        </div>

        {/* Footer skeleton */}
        <div className="flex items-center justify-between pt-3 border-t border-white/5">
            <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-white/10"></div>
                <div className="h-3 w-20 bg-white/5 rounded"></div>
            </div>
            <div className="h-3 w-16 bg-white/5 rounded"></div>
        </div>
    </div>
);

const SkeletonColumn: React.FC = () => (
    <div className="flex-1 min-w-[300px]">
        {/* Column header skeleton */}
        <div className="flex items-center justify-between mb-4 px-4">
            <div className="flex items-center gap-3">
                <div className="h-4 w-24 bg-white/10 rounded"></div>
                <div className="h-5 w-8 bg-white/5 rounded"></div>
            </div>
            <div className="w-2 h-2 rounded-full bg-white/10"></div>
        </div>

        {/* Column body with cards */}
        <div className="rounded-2xl bg-[#0a0a0a]/50 border border-white/10 p-4 space-y-4 min-h-[300px]">
            <SkeletonCard />
            <SkeletonCard />
        </div>
    </div>
);

const SkeletonSidebar: React.FC = () => (
    <div className="p-4 space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-3 p-2 animate-pulse">
                <div className="w-5 h-5 rounded bg-white/10"></div>
                <div className="h-4 flex-1 bg-white/10 rounded"></div>
            </div>
        ))}
    </div>
);

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
    type = 'card',
    count = 1
}) => {
    if (type === 'column') {
        return (
            <div className="flex gap-6">
                {Array.from({ length: count }).map((_, i) => (
                    <SkeletonColumn key={i} />
                ))}
            </div>
        );
    }

    if (type === 'sidebar') {
        return <SkeletonSidebar />;
    }

    return (
        <div className="space-y-4">
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonCard key={i} />
            ))}
        </div>
    );
};

export default SkeletonLoader;
