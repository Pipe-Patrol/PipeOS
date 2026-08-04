export {}

// showDirectoryPicker is not yet in the standard lib typings. The handle types
// it returns (FileSystemDirectoryHandle, etc.) are.
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite'
    }) => Promise<FileSystemDirectoryHandle>
  }
}
