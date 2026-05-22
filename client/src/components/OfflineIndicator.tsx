import { useState, useEffect } from 'react';
import { WifiOff, CloudOff, RefreshCw } from 'lucide-react';
import { useOfflineSupport } from '@/hooks/useOffline';

export function OfflineIndicator() {
  const { online, pendingCount, syncing, sync } = useOfflineSupport();
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (!online || pendingCount > 0) {
      setShowBanner(true);
    } else {
      const timer = setTimeout(() => setShowBanner(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [online, pendingCount]);

  if (online && pendingCount === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2">
      <div className={`
        flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border
        ${online ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}
      `}>
        {syncing ? (
          <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
        ) : online ? (
          <CloudOff className="w-5 h-5 text-yellow-600" />
        ) : (
          <WifiOff className="w-5 h-5 text-red-600" />
        )}
        
        <div className="flex flex-col">
          <span className={`text-sm font-medium ${
            online ? 'text-yellow-800' : 'text-red-800'
          }`}>
            {!online ? 'You are offline' : 'Pending sync'}
          </span>
          <span className="text-xs text-gray-600">
            {pendingCount > 0 
              ? `${pendingCount} action${pendingCount > 1 ? 's' : ''} pending`
              : 'Waiting for connection...'}
          </span>
        </div>

        {(online || pendingCount > 0) && (
          <button
            onClick={sync}
            disabled={syncing}
            className="ml-2 px-3 py-1 text-xs font-medium bg-white border rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        )}
      </div>
    </div>
  );
}

interface OfflineClockButtonProps {
  onClockIn: () => void;
  onClockOut: () => void;
  isClockedIn: boolean;
  loading: boolean;
}

export function OfflineClockButton({ onClockIn, onClockOut, isClockedIn, loading }: OfflineClockButtonProps) {
  const { online, clockInOffline, clockOutOffline } = useOfflineSupport();
  
  const handleClick = async () => {
    const userId = localStorage.getItem('user_id');
    if (!userId) return;

    if (isClockedIn) {
      if (online) {
        await onClockOut();
      } else {
        await clockOutOffline(userId);
      }
    } else {
      if (online) {
        await onClockIn();
      } else {
        await clockInOffline(userId);
      }
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors
        ${!online 
          ? 'bg-orange-100 text-orange-800 border border-orange-300' 
          : isClockedIn 
            ? 'bg-red-100 text-red-800 hover:bg-red-200' 
            : 'bg-green-100 text-green-800 hover:bg-green-200'
        }
      `}
    >
      {!online && <WifiOff className="w-4 h-4" />}
      {loading ? (
        <RefreshCw className="w-4 h-4 animate-spin" />
      ) : isClockedIn ? (
        <>Clock Out</>
      ) : (
        <>Clock In</>
      )}
      {!online && <span className="text-xs">(Offline)</span>}
    </button>
  );
}