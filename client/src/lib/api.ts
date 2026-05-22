import axios from 'axios';

const envApiUrl = (import.meta.env.VITE_API_URL || '').trim();
const normalizedApiUrl = envApiUrl.replace(/\/$/, '');
const baseURL = normalizedApiUrl
    ? (normalizedApiUrl.endsWith('/api') ? normalizedApiUrl : `${normalizedApiUrl}/api`)
    : '/api';

const api = axios.create({
    baseURL,
    withCredentials: true,
});

api.interceptors.request.use((config) => {
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Ignore 401 for auth check (it's expected when not logged in)
            if (error.config.url?.includes('/auth/me')) {
                return Promise.reject(error);
            }
            console.warn("Unauthorized access");
        }
        return Promise.reject(error);
    }
);

export const uploadFilesDirectly = async (files: File[]) => {
    const uploadedUrls = [];
    for (const file of files) {
        const res = await api.post('/uploads/presign', {
            folder: 'tasks',
            fileName: file.name,
            contentType: file.type
        });
        const { uploadStrategy, relativeUrl, signedUrl, token } = res.data.data;
        if (uploadStrategy === 'supabase_signed_upload' && signedUrl) {
            const headers: Record<string, string> = { 'Content-Type': file.type };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const uploadRes = await fetch(signedUrl, { method: 'PUT', body: file, headers });
            if (!uploadRes.ok) throw new Error('Failed to upload file');
            uploadedUrls.push({ url: relativeUrl, type: file.type, name: file.name });
        } else {
            // legacy strategy, requires multipart form to backend, but we'll assume presign works.
            throw new Error('Supabase presigned URL generation failed');
        }
    }
    return uploadedUrls;
};

export default api;
