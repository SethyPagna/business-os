import assert from 'node:assert/strict'
import {
  buildGroupThumbnailState,
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
  normalizeProductGallery('[" one.jpg ","two.jpg","one.jpg"]', 'fallback.jpg'),
  ['one.jpg', 'two.jpg'],
  'gallery normalization accepts stored JSON array strings',
)

assert.deepEqual(
  normalizeProductGallery(' one.jpg | two.jpg | one.jpg ', 'fallback.jpg'),
  ['one.jpg', 'two.jpg'],
  'gallery normalization accepts stored pipe-delimited strings',
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


// ---------------------------------------------------------------------------
// buildGroupThumbnailState -- a group is one product carrying ONE set of
// photos, but imported data routinely scatters them across several member
// rows (the importer attaches each image to the row its filename matched).
// The group's photo set is the UNION of every member's images, lead first,
// deduped, capped -- so no member's photo is ever orphaned, which is what
// lets the child rows correctly show nothing.
// ---------------------------------------------------------------------------

assert.equal(
  buildGroupThumbnailState([{ id: 2, image_path: '/child.jpg' }], { id: 1, image_path: '/lead.jpg' }).thumbnail,
  '/lead.jpg',
  'the lead row leads the gallery, so its photo is the thumbnail',
)

assert.deepEqual(
  buildGroupThumbnailState(
    [{ id: 1, image_path: '/lead.jpg' }, { id: 2, image_path: '/child.jpg' }],
    { id: 1, image_path: '/lead.jpg' },
  ).gallery,
  ['/lead.jpg', '/child.jpg'],
  'the gallery is the UNION of every member row -- a photo on a child is NOT hidden, it joins the group set',
)

assert.deepEqual(
  buildGroupThumbnailState(
    [{ id: 1, image_path: '/a.jpg' }, { id: 2, image_path: '/a.jpg' }, { id: 3, image_path: '/b.jpg' }],
    { id: 1, image_path: '/a.jpg' },
  ).gallery,
  ['/a.jpg', '/b.jpg'],
  'the same photo on two rows appears once -- deduped across members',
)

assert.equal(
  buildGroupThumbnailState(
    Array.from({ length: 6 }, (_, i) => ({ id: i + 1, image_path: `/p${i}.jpg` })),
    { id: 1, image_path: '/p0.jpg' },
  ).gallery.length,
  3,
  'the union is still capped at the per-product limit (3), not the member count',
)

assert.equal(
  buildGroupThumbnailState(
    [{ id: 1, image_path: null }, { id: 2, image_path: '/child.jpg' }],
    { id: 1, image_path: null },
  ).thumbnail,
  '/child.jpg',
  'a photo on any member row must still be shown, never left invisible',
)

assert.equal(
  buildGroupThumbnailState(
    [{ id: 1, image_path: null }, { id: 2, image_path: '' }],
    { id: 1, image_path: null },
  ).hasImage,
  false,
  'reports no image only when genuinely no row has one',
)

assert.equal(buildGroupThumbnailState(null, null).hasImage, false, 'a null row list is safe')
assert.equal(buildGroupThumbnailState([], undefined).hasImage, false, 'an empty group is safe')
assert.equal(
  buildGroupThumbnailState([null, undefined], null).hasImage,
  false,
  'null entries inside the row list are skipped rather than throwing',
)

console.log('productGalleryHelpers tests passed')
