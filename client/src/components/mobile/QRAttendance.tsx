import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOfflineActions } from '@/lib/offlineManager';
import api from '@/lib/api';
import { QrCode, Camera, Clock, MapPin, RefreshCw, CheckCircle } from 'lucide-react';

interface QRScannerProps {
  onScan?: (code: string) => void;
  enabled?: boolean;
}

export function QRScanner({ onScan, enabled = true }: QRScannerProps) {
  const [manualCode, setManualCode] = useState('');
  const [scanning, setScanning] = useState(false);

  const handleManualSubmit = () => {
    if (manualCode && onScan) {
      onScan(manualCode);
      setManualCode('');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="w-5 h-5" />
          QR Attendance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="aspect-square max-w-[300px] mx-auto bg-muted rounded-lg flex items-center justify-center">
          {enabled ? (
            <div className="text-center p-4">
              <Camera className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Camera access required</p>
              <Button variant="outline" size="sm" className="mt-2">
                Enable Camera
              </Button>
            </div>
          ) : (
            <QrCode className="w-32 h-32 text-muted-foreground" />
          )}
        </div>

        <div className="space-y-2">
          <Label>Or enter code manually</Label>
          <div className="flex gap-2">
            <Input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Enter location code"
            />
            <Button onClick={handleManualSubmit} disabled={!manualCode}>
              Check In
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-medium mb-1">{children}</div>;
}

export function MobileAttendance() {
  const { pending, queueAction, syncNow, pendingCount } = useOfflineActions();
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [checkInStatus, setCheckInStatus] = useState<'none' | 'in' | 'out'>('none');

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.error('Location error:', err)
      );
    }
  }, []);

  const handleCheckIn = async () => {
    const data = {
      checkIn: new Date().toISOString(),
      latitude: location?.lat,
      longitude: location?.lng,
    };

    if (navigator.onLine) {
      try {
        await api.post('/attendance/check-in', data);
        setCheckInStatus('in');
      } catch (e) {
        console.error('Check-in failed:', e);
      }
    } else {
      queueAction('attendance_checkin', data);
      setCheckInStatus('in');
    }
  };

  const handleCheckOut = async () => {
    const data = {
      checkOut: new Date().toISOString(),
      latitude: location?.lat,
      longitude: location?.lng,
    };

    if (navigator.onLine) {
      try {
        await api.post('/attendance/check-out', data);
        setCheckInStatus('out');
      } catch (e) {
        console.error('Check-out failed:', e);
      }
    } else {
      queueAction('attendance_checkout', data);
      setCheckInStatus('out');
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Today's Attendance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4" />
            <span>{location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : 'Getting location...'}</span>
          </div>

          <div className="flex gap-4">
            {checkInStatus === 'none' && (
              <Button onClick={handleCheckIn} className="flex-1" size="lg">
                <Clock className="w-5 h-5 mr-2" />
                Check In
              </Button>
            )}
            {checkInStatus === 'in' && (
              <Button onClick={handleCheckOut} className="flex-1" variant="destructive" size="lg">
                <CheckCircle className="w-5 h-5 mr-2" />
                Check Out
              </Button>
            )}
            {checkInStatus === 'out' && (
              <div className="w-full text-center p-4 bg-muted rounded-lg">
                <CheckCircle className="w-8 h-8 mx-auto text-green-500 mb-2" />
                <p className="font-medium">Have a great day!</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {pendingCount > 0 && (
        <Card className="bg-yellow-50 dark:bg-yellow-950 border-yellow-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-yellow-600" />
                <span className="font-medium">{pendingCount} pending actions</span>
              </div>
              <Button size="sm" onClick={syncNow} disabled={!navigator.onLine}>
                Sync Now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <QRScanner onScan={(code) => console.log('Scanned:', code)} />
    </div>
  );
}