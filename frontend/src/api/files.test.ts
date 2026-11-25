import { describe, expect, it } from 'vitest'
import { readFileAsDataURL } from './files'

describe('readFileAsDataURL', () => {
  it('converts an uploaded image into a base64 data URL', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'pano.jpg', {
      type: 'image/jpeg',
    })
    const result = await readFileAsDataURL(file)
    expect(result).toMatch(/^data:image\/jpeg;base64,/)
  })
})
