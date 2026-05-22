import imageCompression from 'browser-image-compression';

const IMAGE_MIME_PREFIX = 'image/';

export const isCompressibleImage = (file: File) => file.type.startsWith(IMAGE_MIME_PREFIX);

export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!isCompressibleImage(file)) return file;

  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: 0.25,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: 'image/webp',
      initialQuality: 0.78
    });

    return new File([compressed], file.name.replace(/\.[^.]+$/, '.webp'), {
      type: 'image/webp',
      lastModified: Date.now()
    });
  } catch {
    return file;
  }
}

export async function compressFileList(files: File[]): Promise<File[]> {
  return Promise.all(files.map((file) => compressImageIfNeeded(file)));
}
