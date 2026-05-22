declare module 'browser-image-compression' {
  const imageCompression: (file: File, options?: Record<string, unknown>) => Promise<File>;
  export default imageCompression;
}
