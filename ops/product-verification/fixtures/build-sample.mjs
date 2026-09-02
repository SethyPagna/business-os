#!/usr/bin/env node
// Builds the 30-product sample run required by the coordinated plan,
// Section 7, step 6: a sample-input.json (verify-products.mjs's --input)
// plus one fixtures/sample-evidence/<id>.json per product (the mock
// provider's replay data).
//
// Every "designed" field below is traceable to one of three real sources:
//   - ops/product-verification/fixtures/barcode-web-evidence.json
//     (a genuine prior web-verification pass over 15 currentProductIds,
//     dated 2026-09-02)
//   - ops/product-verification/fixtures/prior-recertification-6032-6104.json
//     (73 REVIEW_HEADERS-shaped rows from a genuine prior recertification
//     pass, ids 6032-6104)
//   - fresh WebSearch lookups run in this session for the 15 products that
//     came from barcode-web-evidence.json (that file records only ONE
//     source per product; a second, independently-domained source was
//     needed to exercise this tool's 2-domain nameConfirmed rule -- see
//     README.md for why 2 domains, not 1)
//
// EXCEPTION -- clearly marked below with `constructed: true`: after an
// exhaustive search (documented in the Section 7 report, "What was
// found") turned up ZERO products in the real data with two genuinely
// different, currently-on-record barcodes -- the live `products` table
// has exactly one `barcode` column, and neither the 9,921-row
// product-reconciliation variant set nor the 73-row prior recertification
// pass's `barcode_aliases` column ever recorded a second real value for
// any product -- 3 of the 5 multi-barcode rows and 2 of the 3
// barcode-changed rows attach a constructed second value to an otherwise
// real product, purely to exercise those two flags. This is disclosed
// here, in fixtures/sample-evidence/README.md, and in the Section 7
// report; it is never presented as a real second barcode.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gtinCheckDigitValid } from '../lib/barcode.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const sampleEvidenceDir = path.join(here, 'sample-evidence')
fs.mkdirSync(sampleEvidenceDir, { recursive: true })

// Group F below is read from this checked-in fixture (a genuine prior
// recertification pass, ids 6032-6104) by id -- not retyped -- so this
// generator is a real, checked dependency on the committed data rather
// than a copy of its numbers that could silently drift from it.
const priorRecertRows = JSON.parse(fs.readFileSync(path.join(here, 'prior-recertification-6032-6104.json'), 'utf8'))
const priorRecertById = new Map(priorRecertRows.map((r) => [String(r.id), r]))

function hit(url, title, { brand = true, product = true, variant = true, proposedName, source } = {}) {
  return { url, title, proposedName: proposedName || title, matchesBrand: brand, matchesProduct: product, matchesVariant: variant, source }
}

// A second, constructed-but-checksum-valid GTIN-13 for the multi_barcode
// flag demo rows -- built by taking a real product's own barcode digits,
// changing the interior digits deterministically, and solving for a check
// digit that passes gtinCheckDigitValid (the same function reconcile.mjs's
// own tests validate against 15 real barcodes). Not claimed to be any real
// product's actual second barcode.
function constructedAlias(seedDigits) {
  const body = seedDigits.slice(0, -1).split('').map((d, i) => (i === 2 ? String((Number(d) + 4) % 10) : d)).join('')
  for (let check = 0; check <= 9; check += 1) {
    const candidate = body + String(check)
    if (gtinCheckDigitValid(candidate)) return candidate
  }
  throw new Error('no valid check digit found (should not happen for 0-9)')
}

const products = []

// ---------------------------------------------------------------------
// GROUP A -- barcode-web-evidence.json's 7 "approved_fill" rows, each
// given a second independent-domain name source via fresh WebSearch so
// nameConfirmed (>=2 domains) is reachable. Designed tier: high.
// ---------------------------------------------------------------------
products.push({
  id: 195, name: 'Aveeno Eye Cream 14mL', brand: 'Aveeno', category: 'Skincare',
  barcodes: ['381371163816', constructedAlias('381371163816')],
  designedTier: 'high', groupTags: ['A', 'multi_barcode(constructed)'],
  nameHits: [
    hit('https://www.upcitemdb.com/upc/381371163816', 'UPC 381371163816 - Aveeno Absolutely Ageless 3in1 Under Eye AntiWrinkle Cream - 0.5oz', { proposedName: 'Aveeno Absolutely Ageless 3-in-1 Under Eye Anti-Wrinkle Cream 0.5 oz' }),
    hit('https://www.amazon.com/Aveeno-Anti-Wrinkle-Antioxidant-Rich-Hypoallergenic-Non-Comedogenic/dp/B016OIV4VA', 'Aveeno Absolutely Ageless 3-in-1 Anti-Wrinkle Eye Cream, 0.5 oz', { proposedName: 'Aveeno Absolutely Ageless 3-in-1 Under Eye Anti-Wrinkle Cream 0.5 oz' }),
  ],
  barcodeHits: {
    '381371163816': [hit('https://www.walmart.com/ip/380383842', 'Aveeno Absolutely Ageless Eye Cream 0.5 oz / 14 g', { proposedName: 'Aveeno Absolutely Ageless 3-in-1 Under Eye Anti-Wrinkle Cream 0.5 oz' })],
  },
})

products.push({
  id: 204, name: 'Aveeno Restorative Night Cream', brand: 'Aveeno', category: 'Skincare',
  barcodes: ['381371163779'], designedTier: 'high', groupTags: ['A'],
  nameHits: [
    hit('https://www.upcitemdb.com/upc/381371163779', 'UPC 381371163779 - Aveeno Absolutely Ageless Restorative Night Cream for Face 1.7 oz', { proposedName: 'Aveeno Absolutely Ageless Restorative Night Cream 1.7 oz' }),
    hit('https://www.walmart.com/ip/Aveeno-Absolutely-Ageless-Restorative-Night-Face-Cream-1-7-fl-oz/47431331', 'Aveeno Absolutely Ageless Restorative Night Cream for Face, 1.7 oz', { proposedName: 'Aveeno Absolutely Ageless Restorative Night Cream 1.7 oz' }),
  ],
  barcodeHits: {
    '381371163779': [hit('https://www.karewell.com/product/Aveeno-Absolutely-Ageless-Restorative-Facial-Anti-Aging-Night-Cream-1-7-Oz', 'Aveeno Absolutely Ageless Restorative Night Cream 1.7 oz', { proposedName: 'Aveeno Absolutely Ageless Restorative Night Cream 1.7 oz' })],
  },
})

products.push({
  id: 498, name: 'Caudalie VinoPure លាបមុន 15ml', brand: 'Caudalie', category: 'Skincare',
  barcodes: ['3522931005024', constructedAlias('3522931005024')],
  designedTier: 'high', groupTags: ['A', 'multi_barcode(constructed)'],
  nameHits: [
    hit('https://www.cultbeauty.com/p/caudalie-vinopure-salicylic-spot-solution-15ml/14843624/', 'Caudalie Vinopure Salicylic Spot Solution 15ml', { proposedName: 'Caudalie Vinopure Salicylic Acid Spot Solution 15ml' }),
    hit('https://www.caretobeauty.com/us/caudalie-vinopure-stop-boutons-salicylique-15ml/', 'Caudalie Vinopure Salicylic Spot Solution 15ml (0.5floz) USA', { proposedName: 'Caudalie Vinopure Salicylic Acid Spot Solution 15ml' }),
  ],
  barcodeHits: {
    '3522931005024': [hit('https://www.jeancoutu.com/magasiner/categories/beaute/soins-du-visage/soins-cibles/boutons-ou-acne/vinopure-solution-ciblee-salicylique/p/3522931005024', 'Vinopure Solution Ciblée Salicylique', { proposedName: 'Caudalie Vinopure Salicylic Acid Spot Solution 15ml' })],
  },
})

products.push({
  id: 1237, name: 'Clarins Soothing Toning Lotion 400ml', brand: 'Clarins', category: 'Skincare',
  barcodes: ['3380810378863'], designedTier: 'high', groupTags: ['A'],
  nameHits: [
    hit('https://www.clarinsusa.com/en/soothing-toning-face-lotion---sensitive-skin/CS00928223.html', 'Soothing Toning Face Lotion - Sensitive Skin | CLARINS', { proposedName: 'Clarins Soothing Toning Lotion 400ml' }),
    hit('https://www.ebay.com/itm/284780219217', 'Clarins Soothing Toning Lotion 400ml With Chamomile & Saffron Flower Extracts', { proposedName: 'Clarins Soothing Toning Lotion 400ml' }),
  ],
  barcodeHits: {
    '3380810378863': [hit('https://www.argos.co.uk/product/7898772', 'Clarins Soothing Toning Lotion 400 ml', { proposedName: 'Clarins Soothing Toning Lotion 400ml' })],
  },
})

products.push({
  id: 1373, name: 'CLINIQUE Cleansing Balm 125ml', brand: 'Clinique', category: 'Skincare',
  barcodes: ['020714215552'], designedTier: 'high', groupTags: ['A'],
  nameHits: [
    hit('https://www.clinique.com/product/20011/6424/skincare/makeup-removers/take-the-day-off-cleansing-balm', 'Take The Day Off Makeup Remover Cleansing Balm | Clinique', { proposedName: 'Clinique Take The Day Off Cleansing Balm 125ml' }),
    hit('https://www.upcitemdb.com/upc/20714215552', 'UPC 020714215552 - Clinique Take The Day Off Cleansing Balm Makeup Remover - 3.8oz - Ulta Beauty', { proposedName: 'Clinique Take The Day Off Cleansing Balm 125ml' }),
  ],
  barcodeHits: {
    '020714215552': [hit('https://www.iciparisxl.be/fr/clinique/take-the-day-off-cleansing-balm/baume-demaquillant-tous-types-de-peaux/p/BP_742123', 'Clinique Take The Day Off Cleansing Balm 125 ml', { proposedName: 'Clinique Take The Day Off Cleansing Balm 125ml' })],
  },
})

// The prior artifact's own evidence text names the brand as Shiseido
// ELIXIR, not SK-II -- the input row below intentionally carries the
// catalog's actual (uncorrected) current name/brand so this run can show
// what a mismatched current-brand guess looks like against real evidence.
products.push({
  id: 2361, name: 'Elixir The Serum+Essence', brand: 'SK-II', category: 'Skincare',
  barcodes: ['4909978282509'], designedTier: 'medium', groupTags: ['A(brand mismatch demo)'],
  nameHits: [
    hit('https://sundrug-online.com/en/products/4909978282509', 'Shiseido ELIXIR The Serum aa Limited Trial Set', { brand: false, product: true, variant: true, proposedName: 'Shiseido Elixir The Serum aa Limited Trial Set (50ml serum + 18ml lotion)' }),
    hit('https://www.sk-ii.com/our-products/beauty-essences-and-serums', 'Anti-Aging Treatment Serums and Essences | SK-II US', { brand: true, product: false, variant: false, proposedName: 'SK-II Facial Treatment Essence line' }),
  ],
  barcodeHits: {
    '4909978282509': [hit('https://sundrug-online.com/en/products/4909978282509', 'Shiseido ELIXIR The Serum aa Limited Trial Set', { brand: false, product: true, variant: true, proposedName: 'Shiseido Elixir The Serum aa Limited Trial Set (50ml serum + 18ml lotion)' })],
  },
})

products.push({
  id: 2827, name: 'Haku Serum Melanofocus IV 45g', brand: 'Shiseido', category: 'Skincare',
  barcodes: ['4909978224479'], designedTier: 'high', groupTags: ['A'],
  nameHits: [
    hit('https://japanesetaste.com/products/shiseido-haku-melanofocus-iv-brightening-beauty-serum-45g', 'Shiseido Haku Melanofocus IV Brightening Beauty Serum 45g', { proposedName: 'Shiseido HAKU Melanofocus IV Whitening Serum 45g' }),
    hit('https://wafuu.com/en-us/products/shiseido-haku-melanofocus-ev-whitening-serum-45g', 'Shiseido HAKU Melanofocus IV Whitening Serum 45g', { proposedName: 'Shiseido HAKU Melanofocus IV Whitening Serum 45g' }),
  ],
  barcodeHits: {
    '4909978224479': [hit('https://ainz-tulpe.jp/products/4909978224479', 'HAKU Melanofocus IV 45g', { proposedName: 'Shiseido HAKU Melanofocus IV Whitening Serum 45g' })],
  },
})

// ---------------------------------------------------------------------
// GROUP B -- barcode-web-evidence.json's 8 "rejected_no_fill" rows: the
// barcode did NOT corroborate (junk check digit, different bundle, or no
// reliable match). Designed tier: medium (name confirmed, barcode
// doesn't help) or low (name itself unclear, e.g. Chanel below).
// ---------------------------------------------------------------------
products.push({
  id: 660, name: 'Chanel Glow Foundation BD01 SPF25', brand: 'Chanel', category: 'Makeup',
  barcodes: ['31458918'], designedTier: 'low', groupTags: ['B'],
  // Real: gtinCheck failed (invalid_expected_check_digit_7_actual_8) --
  // barcode-web-evidence.json's own recorded reason, replicated here as
  // the barcode digits so this tool's own classifyBarcode independently
  // reaches the same "invalid" conclusion.
  nameHits: [
    hit('https://www.chanel.com/us/makeup/p/184720/les-beiges-foundation-healthy-glow-foundation-hydration-and-longwear/', 'LES BEIGES FOUNDATION Healthy glow foundation hydration and longwear Bd01', { brand: true, product: false, variant: false, proposedName: 'Chanel Les Beiges Healthy Glow Foundation BD01' }),
  ],
  barcodeHits: {},
})

products.push({
  id: 1058, name: 'Charlotte Tilbury Setting Spray No Box 100ml', brand: 'Charlotte Tilbury', category: 'Makeup',
  barcodes: ['5056446657228'], designedTier: 'medium', groupTags: ['B(name_barcode_conflict)'],
  nameHits: [
    hit('https://www.charlottetilbury.com/us/product/airbrush-flawless-setting-spray', 'Airbrush Flawless Setting Spray: Hydrating Waterproof Setting Spray | Charlotte Tilbury', { proposedName: 'Charlotte Tilbury Airbrush Flawless Setting Spray 100ml' }),
    hit('https://www.ulta.com/p/airbrush-flawless-setting-spray-pimprod2043342?sku=2619571', 'Charlotte Tilbury - Airbrush Flawless Hydrating & Waterproof Setting Spray', { proposedName: 'Charlotte Tilbury Airbrush Flawless Setting Spray 100ml' }),
  ],
  barcodeHits: {
    '5056446657228': [hit('https://www.bol.com/be/nl/p/charlotte-tilbury-airbrush-flawless-setting-spray-xl-mini-duo-gezichtsset/9300000353449588/', 'Charlotte Tilbury Airbrush Flawless Setting Spray XL + Mini Duo', { brand: true, product: true, variant: false, proposedName: 'Charlotte Tilbury Airbrush Flawless Setting Spray 100ml + 34ml Duo' })],
  },
})

// Real multi-value barcode: the source spreadsheet recorded two 6-digit
// tokens separated by a space in one cell (product-reconciliation.json /
// barcode-web-evidence.json both preserve "112158 815142" verbatim). This
// tool models that as two barcode entries rather than one 12-digit
// concatenation -- see README.md's "reading a multi-barcode row".
products.push({
  id: 1461, name: 'Colourpop Hello Kitty Aloha Honey', brand: 'ColourPop', category: 'Makeup',
  barcodes: ['112158', '815142'], designedTier: 'medium', groupTags: ['B', 'multi_barcode(real)'],
  nameHits: [
    hit('https://www.ebay.com/itm/166461389521', 'ColourPop Hello Kitty Pressed Powder Blush Aloha Honey', { proposedName: 'ColourPop x Hello Kitty Aloha Honey Pressed Powder Blush' }),
    hit('https://www.temptalia.com/colourpop-x-hello-kitty-aloha-honey-blush-review-swatches/', 'ColourPop x Hello Kitty Aloha Honey Blush Review & Swatches', { proposedName: 'ColourPop x Hello Kitty Aloha Honey Pressed Powder Blush' }),
  ],
  barcodeHits: {},
})

products.push({
  id: 1462, name: 'Colourpop Hello Kitty Island Shine', brand: 'ColourPop', category: 'Makeup',
  barcodes: ['851212', '151192'], designedTier: 'medium', groupTags: ['B', 'multi_barcode(real)'],
  nameHits: [
    hit('https://www.amazon.com/Colourpop-Island-Shine-Blush-Collection/dp/B097S3DRNN', 'Colourpop "Island Shine" Blush - Hello Kitty Tropical Escape Collection', { proposedName: 'ColourPop x Hello Kitty Island Shine Pressed Powder Blush' }),
    hit('https://www.temptalia.com/colourpop-x-hello-kitty-island-shine-blush-review-swatches/', 'ColourPop x Hello Kitty Island Shine Blush Review & Swatches', { proposedName: 'ColourPop x Hello Kitty Island Shine Pressed Powder Blush' }),
  ],
  barcodeHits: {},
})

products.push({
  id: 1464, name: "Colourpop LIL' Ray Of Sunshine", brand: 'ColourPop', category: 'Makeup',
  barcodes: ['297161516625'], designedTier: 'medium', groupTags: ['B'],
  nameHits: [
    hit('https://basicandbeyondbd.com/products/colourpop-eye-shadow-palette---lil-ray-of-sunshine-cp07', 'Colourpop Eye Shadow Palette - Lil Ray of Sunshine', { proposedName: 'ColourPop Lil Ray of Sunshine Eyeshadow Palette' }),
    hit('https://poshmark.com/listing/Colourpop-Lil-Ray-Of-Sunshine-Eyeshadow-Palette-5ff962ffce1e872a23a1d961', 'Colourpop Lil Ray Of Sunshine Eyeshadow Palette', { proposedName: 'ColourPop Lil Ray of Sunshine Eyeshadow Palette' }),
  ],
  barcodeHits: {},
})

products.push({
  id: 1522, name: 'Colourpop Pressed Blush Palatial', brand: 'ColourPop', category: 'Makeup',
  barcodes: ['165125209512'], designedTier: 'medium', groupTags: ['B'],
  nameHits: [
    hit('https://www.temptalia.com/product/colourpop-pressed-powder-blush/palatial/', 'ColourPop Palatial Pressed Powder Blush Review & Swatches', { proposedName: 'ColourPop Palatial Pressed Powder Blush' }),
    hit('https://poshmark.com/listing/Colourpop-Pressed-Powder-Blush-Palatial-65ff08c1c793c4080ffc6790', 'Colourpop Pressed Powder Blush Palatial', { proposedName: 'ColourPop Palatial Pressed Powder Blush' }),
  ],
  barcodeHits: {},
})

products.push({
  id: 1528, name: 'Colourpop Shadow Stick High Noon', brand: 'ColourPop', category: 'Makeup',
  barcodes: ['192250042784'], designedTier: 'medium', groupTags: ['B'],
  nameHits: [
    hit('https://www.ebay.com/itm/204817242769', 'ColourPop Shadow Stix - High Noon - 0.048oz', { proposedName: 'ColourPop Shadow Stix High Noon' }),
    hit('https://www.amazon.com/ColourPop-Shadow-Stix-Long-Lasting-Built/dp/B0D326PG7C', 'ColourPop Shadow Stix - Cream Eyeshadow Stick', { brand: true, product: true, variant: false, proposedName: 'ColourPop Shadow Stix (line, shade not confirmed)' }),
  ],
  // Real: barcode-web-evidence.json recorded webStatus
  // "no_reliable_matching_result" for this exact code -- no search hits
  // tie the code itself to the shade, replicated here as an empty
  // barcode-search result (a real, legitimate "the code drew a blank"
  // outcome, not a lookup error).
  barcodeHits: { '192250042784': [] },
})

products.push({
  id: 3549, name: 'Laura Mercier Loose Setting Powder', brand: 'Laura Mercier', category: 'Makeup',
  barcodes: ['194250053555'], designedTier: 'medium', groupTags: ['B(name_barcode_conflict)'],
  nameHits: [
    hit('https://www.lauramercier.com/products/translucent-loose-setting-powder', 'Laura Mercier Translucent Loose Setting Powder | Finishing Powder', { proposedName: 'Laura Mercier Translucent Loose Setting Powder' }),
    hit('https://www.sephora.com/product/translucent-loose-setting-powder-P109908', 'Translucent Loose Setting Powder - Laura Mercier | Sephora', { proposedName: 'Laura Mercier Translucent Loose Setting Powder' }),
  ],
  barcodeHits: {
    '194250053555': [hit('https://socute.vn/products/phan-bong-laura-mercier', 'Laura Mercier The Guiding Star Loose Powder + Puff Set', { brand: true, product: true, variant: false, proposedName: 'Laura Mercier The Guiding Star Loose Powder + Puff Limited Set' })],
  },
})

// ---------------------------------------------------------------------
// GROUP F -- ops/scripts/migration's own 73-row prior recertification
// pass (ids 6032-6104), replayed as-is: official_source_url /
// independent_source_url become name-hits, barcode_source_url becomes a
// barcode-hit. Several rows carry that pass's own prior_confidence /
// prior_evidence text through to the REVIEW_HEADERS passthrough columns.
// This group needed NO fresh searching -- it is 100% the earlier real
// pass's own findings, re-scored under this tool's stricter
// 2-independent-domain rule (see README.md and the Section 7 report for
// why several of these come out lower here than the prior pass's label).
// ---------------------------------------------------------------------
function fGroup({ id, designedTier, note, priorBarcodeConstructed, multiBarcodeConstructed }) {
  const row = priorRecertById.get(String(id))
  if (!row) throw new Error(`no prior-recertification row for id ${id}`)
  const name = row.expected_shop_name
  const brand = row.expected_brand || ''
  const barcode = row.expected_barcode ? String(row.expected_barcode) : ''
  const nameHits = []
  if (row.official_source_url) nameHits.push(hit(row.official_source_url, name, { proposedName: name }))
  if (row.independent_source_url) nameHits.push(hit(row.independent_source_url, name, { proposedName: name }))
  const barcodeHits = {}
  if (barcode && row.barcode_source_url) barcodeHits[barcode] = [hit(row.barcode_source_url, name, { proposedName: name })]
  else if (barcode) barcodeHits[barcode] = []
  const product = {
    id, name, brand, category: '', barcodes: barcode ? [String(barcode)] : [],
    priorConfidence: row.prior_confidence || '', priorEvidence: row.prior_evidence || '',
    designedTier, groupTags: ['F', note].filter(Boolean), nameHits, barcodeHits,
  }
  // Constructed second barcode / prior-verification snapshot for
  // multi_barcode / barcode_changed flag coverage (see file header) --
  // not claimed to be a real second value for this product.
  if (multiBarcodeConstructed) {
    product.barcodes.push(constructedAlias(barcode))
    product.groupTags.push('multi_barcode(constructed)')
  }
  if (priorBarcodeConstructed) product.priorBarcodes = [constructedAlias(barcode)]
  return product
}

products.push(fGroup({ id: 6033, designedTier: 'high', multiBarcodeConstructed: true }))
products.push(fGroup({ id: 6041, designedTier: 'high' }))
products.push(fGroup({ id: 6044, designedTier: 'high' }))
products.push(fGroup({ id: 6032, designedTier: 'low', note: 'single-source (barcode corroborates but never rescues confidence alone)' }))
products.push(fGroup({ id: 6034, designedTier: 'low', note: 'single-source; barcode_changed(constructed)', priorBarcodeConstructed: true }))
products.push(fGroup({ id: 6035, designedTier: 'low', note: 'single-source' }))
products.push(fGroup({ id: 6038, designedTier: 'low', note: 'single-source' }))
products.push(fGroup({ id: 6039, designedTier: 'low', note: 'single-source' }))
products.push(fGroup({ id: 6040, designedTier: 'low', note: 'single-source; real prior pass held this at low too (Grape vs Grapefruit conflict)' }))
products.push(fGroup({ id: 6043, designedTier: 'low', note: 'single-source' }))
products.push(fGroup({ id: 6042, designedTier: 'low', note: 'no fresh evidence located (real outcome from the prior pass)' }))
products.push(fGroup({ id: 6066, designedTier: 'low', note: 'no barcode on record (real)' }))
products.push(fGroup({ id: 6075, designedTier: 'low', note: 'no fresh evidence located; barcode_changed(constructed)', priorBarcodeConstructed: true }))
products.push(fGroup({ id: 6093, designedTier: 'low', note: 'no evidence and no barcode on record (real)' }))

// Real barcode_changed case: the source-import row recorded
// "716170241333" (a valid 12-digit GTIN) for this old id, but the
// current, live product record (matched by fuzzy name, not barcode) now
// carries "07161702412" -- an 11-digit, non-standard-length value. Both
// numbers are genuinely on record somewhere in the real artifacts; this
// tool never had to invent either one for this row.
products.push({
  id: 342, name: 'Bobbi Brown Skin Fluid N-012', brand: 'Bobbi Brown', category: 'Makeup',
  barcodes: ['07161702412'], priorBarcodes: ['716170241333'],
  designedTier: 'low', groupTags: ['barcode_changed(real)'],
  nameHits: [], barcodeHits: {},
})

// ---------------------------------------------------------------------
// Write sample-input.json + one fixture per product.
// ---------------------------------------------------------------------
const sampleInput = products.map((p) => ({
  id: p.id,
  name: p.name,
  brand: p.brand,
  category: p.category || '',
  description: `Official Product Name:\n${p.name}`,
  barcodes: p.barcodes.join('|'),
  prior_barcodes: (p.priorBarcodes || []).join('|'),
  prior_confidence: p.priorConfidence || '',
  prior_evidence: p.priorEvidence || '',
}))
fs.writeFileSync(path.join(here, 'sample-input.json'), JSON.stringify(sampleInput, null, 2), 'utf8')

for (const p of products) {
  const fixture = { name: p.nameHits, barcodes: p.barcodeHits }
  fs.writeFileSync(path.join(sampleEvidenceDir, `${p.id}.json`), JSON.stringify(fixture, null, 2), 'utf8')
}

// A small manifest documenting the designed tier and group tags per
// product, for the Section 7 report's "expected vs actual" table -- not
// consumed by verify-products.mjs itself.
fs.writeFileSync(
  path.join(here, 'sample-manifest.json'),
  JSON.stringify(products.map((p) => ({ id: p.id, name: p.name, designedTier: p.designedTier, groupTags: p.groupTags })), null, 2),
  'utf8',
)

console.log(`Wrote sample-input.json (${products.length} products), ${products.length} sample-evidence fixtures, and sample-manifest.json`)
console.log('multi_barcode rows:', products.filter((p) => p.barcodes.length > 1).map((p) => p.id).join(', '))
console.log('barcode_changed rows:', products.filter((p) => p.priorBarcodes && p.priorBarcodes.length).map((p) => p.id).join(', '))
