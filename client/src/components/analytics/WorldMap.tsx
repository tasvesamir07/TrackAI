import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Globe, Users, MapPin, Activity, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface GeoData {
  country: string;
  countryCode: string;
  requests: number;
  uniqueIPs: number;
  cities: { name: string; count: number }[];
}

interface WorldMapProps {
  data?: GeoData[];
}

const countryCentroids: Record<string, [number, number]> = {
  US: [37.09, -95.71], GB: [55.38, -3.44], DE: [51.17, 10.45],
  FR: [46.60, 1.89], IT: [41.87, 12.57], ES: [40.46, -3.75],
  CA: [56.13, -106.35], AU: [-25.27, 133.78], BR: [-14.24, -51.93],
  IN: [20.59, 78.96], RU: [61.52, 105.32], CN: [35.86, 104.20],
  JP: [36.20, 138.25], KR: [35.91, 127.77], MX: [23.63, -102.55],
  ID: [-0.79, 113.92], NL: [52.13, 5.29], SA: [23.89, 45.08],
  CH: [46.82, 8.23], SE: [60.13, 18.64], NO: [60.47, 8.47],
  AR: [-38.42, -63.62], ZA: [-30.56, 22.94], NG: [9.08, 8.68],
  EG: [26.82, 30.80], TR: [38.96, 35.24], PK: [30.38, 69.35],
  BD: [23.68, 90.36], VN: [14.06, 108.28], TH: [15.87, 100.99],
  PH: [12.88, 121.77], MY: [4.21, 101.98], SG: [1.35, 103.82],
  AE: [23.42, 53.85], IL: [31.05, 34.85], IE: [53.14, -8.24],
  DK: [55.67, 10.33], FI: [61.92, 25.75], PL: [51.92, 19.15],
  PT: [39.40, -8.22], BE: [50.50, 4.47], AT: [47.52, 14.55],
  NZ: [-40.90, 174.89], CO: [4.57, -74.30], CL: [-35.68, -71.54],
  PE: [-9.19, -75.02], UA: [48.38, 31.17], RO: [45.94, 24.97],
  CZ: [49.82, 15.47], GR: [39.07, 22.58], HU: [47.16, 19.50],
  TW: [23.70, 120.96], HK: [22.32, 114.17], XX: [20, 0],
};

export function WorldMap({ data: initialData }: WorldMapProps) {
  const [geoData, setGeoData] = useState<GeoData[]>(initialData || []);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  const { data: apiData, isLoading } = useQuery({
    queryKey: ['geo-analytics'],
    queryFn: async () => {
      const res = await api.get('/superadmin/analytics/geo');
      return res.data.data || [];
    },
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (apiData) {
      setGeoData(apiData);
    }
  }, [apiData]);

  const totalRequests = useMemo(() => geoData.reduce((sum, g) => sum + g.requests, 0), [geoData]);
  const totalIPs = useMemo(() => geoData.reduce((sum, g) => sum + g.uniqueIPs, 0), [geoData]);
  const maxRequests = useMemo(() => Math.max(...geoData.map(g => g.requests), 1), [geoData]);
  const countryNameResolver = useMemo(() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      return null;
    }
  }, []);

  const normalizedGeoData = useMemo(() => (
    geoData.map((item) => {
      const code = String(item.countryCode || '').toUpperCase();
      const resolvedName = code && code !== 'XX' && countryNameResolver
        ? countryNameResolver.of(code)
        : null;
      return {
        ...item,
        country: resolvedName || item.country || code || 'Unknown',
      };
    })
  ), [countryNameResolver, geoData]);

  const getMarkerSize = (requests: number) => {
    const ratio = requests / maxRequests;
    return Math.max(8, Math.min(40, Math.round(ratio * 40)));
  };

  const getMarkerColor = (requests: number) => {
    const ratio = requests / maxRequests;
    if (ratio < 0.1) return '#3b82f6';
    if (ratio < 0.25) return '#22c55e';
    if (ratio < 0.5) return '#eab308';
    if (ratio < 0.75) return '#f97316';
    return '#ef4444';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Geographic Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="text-center p-4 bg-muted rounded-lg">
            <Activity className="w-6 h-6 mx-auto mb-2 text-blue-500" />
            <div className="text-2xl font-bold">{totalRequests.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total Requests</div>
          </div>
          <div className="text-center p-4 bg-muted rounded-lg">
            <Users className="w-6 h-6 mx-auto mb-2 text-green-500" />
            <div className="text-2xl font-bold">{totalIPs.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Unique IPs</div>
          </div>
          <div className="text-center p-4 bg-muted rounded-lg">
            <MapPin className="w-6 h-6 mx-auto mb-2 text-purple-500" />
            <div className="text-2xl font-bold">{normalizedGeoData.length}</div>
            <div className="text-xs text-muted-foreground">Countries</div>
          </div>
        </div>

        {isLoading && normalizedGeoData.length === 0 ? (
          <div className="aspect-video bg-slate-100 rounded-lg flex items-center justify-center mb-6">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="aspect-video bg-slate-100 rounded-lg mb-6 relative overflow-hidden">
            <MapContainer
              center={[20, 0]}
              zoom={2}
              style={{ height: '100%', width: '100%' }}
              zoomControl={true}
              scrollWheelZoom={false}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {normalizedGeoData.map((geo) => {
                const centroid = countryCentroids[geo.countryCode] || countryCentroids.XX;
                if (!centroid) return null;
                return (
                  <CircleMarker
                    key={geo.countryCode}
                    center={centroid}
                    radius={getMarkerSize(geo.requests)}
                    pathOptions={{
                      color: getMarkerColor(geo.requests),
                      fillColor: getMarkerColor(geo.requests),
                      fillOpacity: 0.6,
                      weight: 1,
                    }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <strong>{geo.country}</strong>
                        <br />
                        Requests: {geo.requests.toLocaleString()}
                        <br />
                        Unique IPs: {geo.uniqueIPs.toLocaleString()}
                        {geo.cities.length > 0 && (
                          <>
                            <br />
                            <span className="text-xs">Top cities:</span>
                            {geo.cities.slice(0, 3).map(c => (
                              <div key={c.name} className="text-xs">
                                {c.name}: {c.count.toLocaleString()}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Country</TableHead>
              <TableHead>Requests</TableHead>
              <TableHead>Unique IPs</TableHead>
              <TableHead>% Traffic</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {normalizedGeoData.map((geo) => (
              <TableRow
                key={geo.countryCode}
                className="cursor-pointer"
                onClick={() => setSelectedCountry(selectedCountry === geo.countryCode ? null : geo.countryCode)}
              >
                <TableCell className="font-medium">{geo.country}</TableCell>
                <TableCell>{geo.requests.toLocaleString()}</TableCell>
                <TableCell>{geo.uniqueIPs.toLocaleString()}</TableCell>
                <TableCell>{totalRequests > 0 ? ((geo.requests / totalRequests) * 100).toFixed(1) : '0.0'}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {selectedCountry && (
          <div className="mt-4 p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-2">
              Top Cities in {normalizedGeoData.find(g => g.countryCode === selectedCountry)?.country}
            </h4>
            <div className="space-y-2">
              {normalizedGeoData.find(g => g.countryCode === selectedCountry)?.cities.map((city) => (
                <div key={city.name} className="flex justify-between text-sm">
                  <span>{city.name}</span>
                  <span className="text-muted-foreground">{city.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
