import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Save, AlertCircle } from 'lucide-react';

export function SSOSetup() {
  const [provider, setProvider] = useState('saml');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [metadataUrl, setMetadataUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/enterprise/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, clientId, clientSecret, metadataUrl })
      });
      const data = await res.json();
      if (data.success) setMessage('SSO configured successfully!');
      else setMessage(data.error || 'Failed to configure SSO');
    } catch {
      setMessage('Failed to connect');
    }
    setLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Single Sign-On (SSO)
        </CardTitle>
        <CardDescription>Configure SAML or OAuth for enterprise authentication</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Provider</Label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="saml">SAML 2.0</SelectItem>
              <SelectItem value="oauth">OAuth 2.0</SelectItem>
              <SelectItem value="oidc">OpenID Connect</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Client ID / Entity ID</Label>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Enter client ID" />
        </div>

        <div className="space-y-2">
          <Label>Client Secret</Label>
          <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="Enter client secret" />
        </div>

        <div className="space-y-2">
          <Label>Metadata URL (Optional)</Label>
          <Input value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)} placeholder="https://idp.example.com/metadata" />
        </div>

        <Button onClick={handleSubmit} disabled={loading} className="w-full gap-2">
          <Save className="w-4 h-4" />
          {loading ? 'Saving...' : 'Save Configuration'}
        </Button>

        {message && (
          <div className={`flex items-center gap-2 p-3 rounded ${message.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            <AlertCircle className="w-4 h-4" />
            {message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}