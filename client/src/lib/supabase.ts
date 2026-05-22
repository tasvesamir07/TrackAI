import { createClient, type Session } from '@supabase/supabase-js';

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

const supabase = (supabaseUrl && supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export const getCachedSupabaseSession = async (): Promise<Session | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session || null;
};

export { supabase };

