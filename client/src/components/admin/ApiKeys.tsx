import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Key, Copy, Plus, Trash2 } from 'lucide-react';
import { Toast } from '@/components/ui/Toast';

export function ApiKeys() {
  const [keys, setKeys] = useState([
    { id: 1, name: 'Production Dashboard Sync', key: 'trk_prod_8f92j3n...', created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), last_used: new Date().toISOString() },
    { id: 2, name: 'Zapier Integration', key: 'trk_live_h4382n...', created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), last_used: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }
  ]);
  const [newKeyName, setNewKeyName] = useState('');
  const [toast, setToast] = useState<{message: string, type: 'success'|'error'} | null>(null);

  const handleGenerateKey = () => {
    if (!newKeyName.trim()) {
      setToast({ message: 'Please enter a name for the API key', type: 'error' });
      return;
    }
    const newKey = {
      id: Date.now(),
      name: newKeyName,
      key: `trk_live_${Math.random().toString(36).substring(2, 15)}`,
      created_at: new Date().toISOString(),
      last_used: 'Never'
    };
    setKeys([newKey, ...keys]);
    setNewKeyName('');
    setToast({ message: 'API key generated successfully', type: 'success' });
  };

  const handleRevokeKey = (id: number) => {
    if (window.confirm('Are you sure you want to revoke this API key? Integrations using it will immediately fail.')) {
      setKeys(keys.filter(k => k.id !== id));
      setToast({ message: 'API key revoked', type: 'success' });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setToast({ message: 'Copied to clipboard', type: 'success' });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>Manage API keys for external integrations and automated scripts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <Input 
              placeholder="Key Name (e.g., Zapier Integration)" 
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="max-w-md"
            />
            <Button onClick={handleGenerateKey}>
              <Plus className="w-4 h-4 mr-2" />
              Generate New Key
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Secret Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.length > 0 ? (
                  keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Key className="w-4 h-4 text-muted-foreground" />
                          {k.name}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        <div className="flex items-center gap-2">
                          {k.key}
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(k.key)}>
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(k.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {k.last_used === 'Never' ? 'Never' : new Date(k.last_used).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleRevokeKey(k.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No API keys generated yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}