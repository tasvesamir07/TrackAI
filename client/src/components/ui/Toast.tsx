import { useEffect, useState } from 'react';
import { X, CheckCircle, Info, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming you have a utils file for class merging, standard in shadcn/ui setups

export interface ToastProps {
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    duration?: number;
    onClose: () => void;
}

export function Toast({ message, type = 'info', duration = 3000, onClose }: ToastProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        let t3: NodeJS.Timeout;
        // Trigger enter animation
        const t1 = setTimeout(() => setIsVisible(true), 10);

        // Trigger auto-close
        const t2 = setTimeout(() => {
            setIsVisible(false);
            // Wait for exit animation to finish before unmounting
            t3 = setTimeout(onClose, 300);
        }, duration);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            if (t3) clearTimeout(t3);
        };
    }, [duration, onClose]);

    const icons = {
        info: <Info size={18} />,
        success: <CheckCircle size={18} />,
        warning: <AlertCircle size={18} />,
        error: <AlertCircle size={18} />
    };

    const bgColors = {
        info: 'bg-slate-800 text-white',
        success: 'bg-green-600 text-white',
        warning: 'bg-yellow-500 text-white',
        error: 'bg-red-500 text-white'
    };

    return (
        <div
            className={cn(
                "fixed top-5 right-5 z-100 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg transition duration-300 transform",
                bgColors[type],
                isVisible ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
            )}
        >
            <div className="shrink-0">
                {icons[type]}
            </div>
            <p className="text-sm font-medium pr-2">
                {message}
            </p>
            <button
                onClick={() => { setIsVisible(false); setTimeout(onClose, 300); }}
                className="hover:opacity-70 transition-opacity ml-auto"
            >
                <X size={16} />
            </button>
        </div>
    );
}
