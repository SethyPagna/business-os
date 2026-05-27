import assert from 'node:assert/strict'
import {
  buildProductThumbnailState,
  buildProductLightboxGalleryInput,
  buildProductLightboxState,
  clampProductLightboxIndex,
  getProductGalleryImages,
  normalizeProductGallery,
  resolveProductImageUrl,
  updateProductLightboxIndex,
} from '../src/components/products/helpers/productGalleryHelpers.ts'

assert.deepEqual(
  normalizeProductGallery([' one.jpg ', 'two.jpg', 'one.jpg', '', null, 'three.jpg'], 'fallback.jpg'),
  ['one.jpg', 'two.jpg', 'three.jpg'],
  'gallery normalization trims, de-dupes, and ignores blank entries',
)

assert.deepEqual(
  normalizeProductGallery([], ' fallback.jpg '),
  ['fallback.jpg'],
  'gallery normalization uses the fallback when no gallery images are present',
)

assert.deepEqual(
  normalizeProductGallery(['1.jpg', '2.jpg', '3.jpg'], '', 2),
  ['1.jpg', '2.jpg'],
  'gallery normalization respects the item limit',
)

assert.deepEqual(
  getProductGalleryImages({ image_gallery: [' gallery.jpg '], image_path: 'main.jpg' }),
  ['gallery.jpg'],
  'product gallery prefers explicit gallery images',
)

assert.deepEqual(
  getProductGalleryImages({ image_gallery: [], image_path: ' main.jpg ' }),
  ['main.jpg'],
  'product gallery falls back to the primary image path',
)

assert.deepEqual(
  buildProductThumbnailState({ image_gallery: [' one.jpg ', 'two.jpg'], image_path: 'main.jpg' }),
  {
    gallery: ['one.jpg', 'two.jpg'],
    hasImage: true,
    thumbnail: 'one.jpg',
  },
  'thumbnail state exposes one normalized gallery for row rendering',
)

assert.deepEqual(
  buildProductThumbnailState({ image_gallery: [], image_path: '' }),
  {
    gallery: [],
    hasImage: false,
    thumbnail: '',
  },
  'thumbnail state handles products without images',
)

assert.equal(resolveProductImageUrl(''), '', 'blank image urls resolve to an empty string')
assert.equal(
  resolveProductImageUrl('/uploads/products/a.png'),
  '/uploads/products/a.png?v=dev',
  'local upload paths use the public asset resolver cache marker',
)

assert.deepEqual(
  buildProductLightboxState(['/uploads/products/a.png', '/uploads/products/b.png'], 99, 'Preview'),
  {
    images: ['/uploads/products/a.png?v=dev', '/uploads/products/b.png?v=dev'],
    index: 1,
    title: 'Preview',
  },
  'lightbox state resolves urls and clamps the starting index',
)

assert.deepEqual(
  buildProductLightboxState(['/uploads/products/a.png'], -2, 'Preview'),
  {
    images: ['/uploads/products/a.png?v=dev'],
    index: 0,
    title: 'Preview',
  },
  'lightbox state clamps negative indexes',
)

assert.deepEqual(
  buildProductLightboxState(['/uploads/products/a.png'], 'not-a-number', 'Preview'),
  {
    images: ['/uploads/products/a.png?v=dev'],
    index: 0,
    title: 'Preview',
  },
  'lightbox state falls back to the first image for invalid indexes',
)

assert.equal(
  buildProductLightboxState([], 0, 'Empty'),
  null,
  'lightbox state is null when no images resolve',
)

assert.deepEqual(
  buildProductLightboxGalleryInput('fallback.jpg', [' one.jpg ', '', 'one.jpg', 'two.jpg']),
  ['one.jpg', 'two.jpg'],
  'detail lightbox input prefers normalized gallery images',
)

assert.deepEqual(
  buildProductLightboxGalleryInput(' fallback.jpg ', []),
  ['fallback.jpg'],
  'detail lightbox input falls back to the clicked image source',
)

assert.deepEqual(
  buildProductLightboxGalleryInput('', ['', null]),
  [],
  'detail lightbox input stays empty when gallery and source are blank',
)

assert.equal(clampProductLightboxIndex(5, 3), 2, 'lightbox index clamps above the gallery length')
assert.equal(clampProductLightboxIndex(-5, 3), 0, 'lightbox index clamps below zero')
assert.equal(clampProductLightboxIndex('bad', 3), 0, 'lightbox index falls back for invalid values')
assert.equal(clampProductLightboxIndex(2, 0), 0, 'lightbox index handles empty galleries')

assert.deepEqual(
  updateProductLightboxIndex(
    { images: ['a.jpg', 'b.jpg', 'c.jpg'], index: 1, title: 'Preview' },
    99,
  ),
  { images: ['a.jpg', 'b.jpg', 'c.jpg'], index: 2, title: 'Preview' },
  'lightbox index updates preserve existing state and clamp the next index',
)

assert.equal(updateProductLightboxIndex(null, 1), null, 'lightbox index update preserves null state')

console.log('productGalleryHelpers tests passed')
