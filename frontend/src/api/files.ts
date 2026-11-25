/** FileReader wrapper used to inline the uploaded panorama in the run payload. */

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not read the panorama file.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the panorama file.'))
    reader.readAsDataURL(file)
  })
}
