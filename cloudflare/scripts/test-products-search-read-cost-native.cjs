// D1 rows read by GET /api/products/search (and the products list), GET /api/products/search-index and the
// customer picker, on local workerd (D1's own meta.rows_read per statement, summed over the request), with every
// response pinned byte-for-byte to the output of the implementation before the read-cost lane (04ab054cb) on a
// production-shaped fixture (inactive members and parents, Khmer names, 62 blank-named rows tying across pages): name families, parent-linked variants (one family under a BLANK-name parent), blank
// names, discounts, a live promotion rule, two branches, lots, galleries.
//
// GOLDEN[label] = [sha256 of the response body at 04ab054cb, rows read at 04ab054cb, ceiling for this code].
// A drift in any hash means rows, order, totals, stock or galleries changed. The ceilings are the measured rows
// of the new code plus 5 per cent, so a regression to the old three-walk statement (or to the index scan in
// search-index) fails here. PRINT_GOLDEN=1 prints [sha, rows] for the current code instead of asserting.
//
// Run: node scripts/test-products-search-read-cost-native.cjs   (about two minutes: it migrates a workerd D1)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { openWorld } = require('./harness/read-cost-world.cjs')
const { catalogFixture } = require('./harness/read-cost-fixture.cjs')
const P = 2000, CUSTOMERS = 3000
const sha = text => createHash('sha256').update(text).digest('hex')
const SEARCH = '/api/products/search'
const BATTERY = {
  'browse': `${SEARCH}?page=1&pageSize=20&surface=pos&sort=name_asc`,
  'browse_p3_50': `${SEARCH}?page=3&pageSize=50&surface=products&sort=name_asc`,
  'browse_past_end': `${SEARCH}?page=999&pageSize=20&surface=pos`,
  'created_desc': `${SEARCH}?page=2&pageSize=30&sort=created_desc`,
  'created_asc': `${SEARCH}?page=1&pageSize=25&sort=created_asc`,
  'name_desc': `${SEARCH}?page=1&pageSize=20&sort=name_desc`,
  'q_serum': `${SEARCH}?page=1&pageSize=20&surface=pos&query=serum`,
  'q_serum_p2': `${SEARCH}?page=2&pageSize=20&surface=pos&query=serum`,
  'q_multiword': `${SEARCH}?page=1&pageSize=20&surface=pos&query=product%20120%20powder`,
  'q_barcode': `${SEARCH}?page=1&pageSize=20&surface=pos&query=8850000001203`,
  'q_title_only': `${SEARCH}?page=1&pageSize=20&query=cream&searchFields=name`,
  'q_nothing': `${SEARCH}?page=1&pageSize=20&query=zzzzqqqq`,
  'q_page_past_end': `${SEARCH}?page=50&pageSize=20&query=serum`,
  'branch1_in_stock': `${SEARCH}?page=1&pageSize=20&branchId=1&stockState=in_stock`,
  'branch2_out': `${SEARCH}?page=1&pageSize=20&branchId=2&stockState=out`,
  'low_stock': `${SEARCH}?page=1&pageSize=20&stockState=low&sort=name_asc`,
  'brand_cat': `${SEARCH}?page=1&pageSize=20&brand=Brand3,Brand5&category=Cat3,Cat5`,
  'grouped': `${SEARCH}?page=1&pageSize=20&groupState=grouped`,
  'standalone': `${SEARCH}?page=1&pageSize=20&groupState=standalone`,
  'initial': `${SEARCH}?page=1&pageSize=20&initial=P`,
  'promoted': `${SEARCH}?page=1&pageSize=20&promo=promoted`,
  'discounted': `${SEARCH}?page=1&pageSize=20&promo=discounted`,
  'by_ids': `${SEARCH}?pageSize=5&ids=1003,1004,1011,1012`,
  'by_ids_none': `${SEARCH}?pageSize=5&ids=abc`,
  'rank_ids': `${SEARCH}?page=1&pageSize=60&surface=pos&query=serum&rankIds=1004,1008,1012,1016,1011,1051,1100,1104&rankTiers=01233333`,
  'q_child_sku': `${SEARCH}?page=1&pageSize=20&surface=pos&query=SKU-1011`,
  'q_blank_child': `${SEARCH}?page=1&pageSize=20&surface=pos&query=SKU-1006`,
  'browse_p2': `${SEARCH}?page=2&pageSize=20&surface=pos&sort=name_asc`,
  'q_khmer': `${SEARCH}?page=1&pageSize=20&surface=pos&query=${encodeURIComponent('ក្រែម')}`,
  'q_khmer_serum': `${SEARCH}?page=1&pageSize=20&surface=pos&query=${encodeURIComponent('ក្រែមកក់ serum')}`,
  'q_inactive_member': `${SEARCH}?page=1&pageSize=20&surface=pos&query=SKU-1009`,
  'q_inactive_parent_child': `${SEARCH}?page=1&pageSize=20&surface=pos&query=SKU-1061`,
  'by_ids_inactive': `${SEARCH}?pageSize=10&ids=1008,1009,1050,1061,1062`,
  'q_retired': `${SEARCH}?page=1&pageSize=20&query=retired`,
  'rank_ids_320': `${SEARCH}?page=1&pageSize=60&surface=pos&query=serum&rankIds=${Array.from({ length: 320 }, (_, i) => 1000 + ((i * 7) % 2000)).join(',')}&rankTiers=${'3'.repeat(320)}`,
  // the 62 blank-named families tie on name and date; these are the pages (20 per page) where the ties sit, in each sort
  'tie_name_asc_p19': `${SEARCH}?page=19&pageSize=20&sort=name_asc`,
  'tie_name_asc_p20': `${SEARCH}?page=20&pageSize=20&sort=name_asc`,
  'tie_name_asc_p21': `${SEARCH}?page=21&pageSize=20&sort=name_asc`,
  'tie_name_asc_p22': `${SEARCH}?page=22&pageSize=20&sort=name_asc`,
  'tie_name_desc_p73': `${SEARCH}?page=73&pageSize=20&sort=name_desc`,
  'tie_name_desc_p74': `${SEARCH}?page=74&pageSize=20&sort=name_desc`,
  'tie_name_desc_p75': `${SEARCH}?page=75&pageSize=20&sort=name_desc`,
  'tie_name_desc_p76': `${SEARCH}?page=76&pageSize=20&sort=name_desc`,
  'tie_created_desc_p28': `${SEARCH}?page=28&pageSize=20&sort=created_desc`,
  'tie_created_desc_p29': `${SEARCH}?page=29&pageSize=20&sort=created_desc`,
  'tie_created_desc_p30': `${SEARCH}?page=30&pageSize=20&sort=created_desc`,
  'tie_created_desc_p31': `${SEARCH}?page=31&pageSize=20&sort=created_desc`,
  'tie_created_asc_p64': `${SEARCH}?page=64&pageSize=20&sort=created_asc`,
  'tie_created_asc_p65': `${SEARCH}?page=65&pageSize=20&sort=created_asc`,
  'tie_created_asc_p66': `${SEARCH}?page=66&pageSize=20&sort=created_asc`,
  'tie_created_asc_p67': `${SEARCH}?page=67&pageSize=20&sort=created_asc`,
  'include_lots': `${SEARCH}?page=1&pageSize=10&include=tagged_lots`,
  'list': '/api/products',
  // the vocabulary, the first-load bootstrap and typed searches through a filter, a substring, a barcode fragment and a long ranked list: pinned to the output before this lane (hashes taken at 6e8eed496)
  'filters': `/api/products/filters`,
  'filters_pos_branch': `/api/products/filters?branchId=1&surface=pos`,
  'filters_stock_out': `/api/products/filters?branchId=2&stockState=out&brand=Brand3`,
  'filters_cat_brand': `/api/products/filters?category=Cat3,Cat5&brand=Brand3`,
  'filters_grouped': `/api/products/filters?groupState=grouped`,
  'bootstrap_pos': `/api/products/bootstrap?page=1&pageSize=20&surface=pos&metadata=1&branchId=1`,
  'q_cream_branch_stock': `${SEARCH}?page=1&pageSize=20&query=cream&branchId=1&stockState=in_stock`,
  'q_cream_brand_promo': `${SEARCH}?page=1&pageSize=20&query=cream&brand=Brand3,Brand5&promo=discounted`,
  'q_cream_created_asc_p2': `${SEARCH}?page=2&pageSize=7&query=cream&sort=created_asc`,
  'q_substring': `${SEARCH}?page=1&pageSize=20&query=ream`,
  'q_barcode_fragment': `${SEARCH}?page=1&pageSize=20&query=000100`,
  'q_upc_pair': `${SEARCH}?page=1&pageSize=20&query=042100005264`,
  'rank_ids_320_p2': `${SEARCH}?page=2&pageSize=30&surface=pos&query=serum&rankIds=${Array.from({ length: 320 }, (_, i) => 1000 + ((i * 7) % 2000)).join(',')}&rankTiers=${'3'.repeat(320)}`,
  'rank_ids_child_only': `${SEARCH}?page=1&pageSize=30&surface=pos&rankIds=${[1011, 1012].concat(Array.from({ length: 320 }, (_, i) => 1100 + ((i * 3) % 1900))).filter((v, i, arr) => arr.indexOf(v) === i).join(',')}`,
  // non-empty promotion, POS, Products-default and ranked-list shapes (hashes taken at 6e8eed496): the empty-body shapes above only pin "no rows"
  'q_balm_promoted': `${SEARCH}?page=1&pageSize=20&query=balm&promo=promoted`,
  'q_cream_rules': `${SEARCH}?page=1&pageSize=20&query=cream&promo=rules`,
  'q_balm_discounted': `${SEARCH}?page=1&pageSize=20&query=balm&promo=discounted`,
  'pos_text_48': `${SEARCH}?page=1&pageSize=48&query=cream&sort=name_asc&include=branch_stock,images,batches,tagged_lots&surface=pos&branchId=1`,
  'products_text_default': `${SEARCH}?page=1&pageSize=50&query=serum&searchMode=smart&sort=created_desc&include=branch_stock,images,batches,tagged_lots`,
  'comma_or': `${SEARCH}?page=1&pageSize=20&query=serum,balm&searchMode=OR`,
  'rank_ids_1500_p16': `${SEARCH}?page=16&pageSize=30&surface=pos&sort=created_desc&rankIds=${Array.from({ length: 1500 }, (_, i) => 1000 + i).join(',')}&rankTiers=${'0123'.repeat(375)}`,
  'index_p0': '/api/products/search-index?page=0',
  'index_p1': '/api/products/search-index?page=1',
}

// Barcode shapes that need real UPC codes. The fixture has none, so main() writes four barcodes first (UPC_ROWS) and then runs these: the stored UPC-A, its UPC-E, the UPC-A without its
// leading zero and as an EAN-13. A UPC scan returns the first two only; the plain 11-digit text (not a UPC) finds the stored forms of the UPC-A through the normalized catch-all.
const UPC_ROWS = { 1020: '042100005264', 1021: '04252614', 1022: '42100005264', 1024: '0042100005264' }
const UPC_BATTERY = {
  'q_upc_a': `${SEARCH}?page=1&pageSize=25&query=042100005264`,
  'q_upc_e': `${SEARCH}?page=1&pageSize=20&query=04252614`,
  'q_upc_short': `${SEARCH}?page=1&pageSize=20&query=42100005264`,
  'q_upc_ean': `${SEARCH}?page=1&pageSize=20&query=0042100005264`,
  'q_upc_a_branch': `${SEARCH}?page=1&pageSize=20&surface=pos&branchId=1&query=042100005264`,
}
const ALL_ROUTES = { ...BATTERY, ...UPC_BATTERY }

const GOLDEN = {
  browse: ['bee834f06f373adadca7f6f4c2810876d010aeb0481c5f6ece26eb11225575c1', 19076, 10040],
  browse_p3_50: ['6548e64bf667d77701d90e65413446f5df55cdf407ef79b4a948b01166c6eb3f', 19541, 11120],
  browse_past_end: ['87b65a7137cf933663fd01f3c834ae03f4084ac28fd449ac78a5d27a860f7c55', 16624, 13630],
  created_desc: ['aac7d52bd72061bcc92803a0e581450fbbe24af1d2bb87024ff96523d9156c22', 19294, 10510],
  created_asc: ['c2507d26a11fdf586f13a6a3116858d925e40558536354a24d706d9f5608791c', 18971, 9910],
  name_desc: ['b14e8f59d53bc968dcdcee36dd7c7515a021ac6cbd9445e7b642068049995b19', 19005, 9940],
  q_serum: ['d5dd98c1e013aa176c12599482b4d4079335231b19da686648c20dd7c0ce91a9', 22331, 9580],
  q_serum_p2: ['ec517d38e2ea8d2301ebed5e9ee7eaaa6b45fda0758a4e9657e00e22a11ed11d', 22319, 9550],
  q_multiword: ['854c57cf8e8d6f862d6d2ed1381d5676de914bbcf7134ee13afe37832c26f54e', 25361, 11170],
  q_barcode: ['936de0e211bdd96a5fb257cfa4316098194dc7aa97469caa7a259b5dced633b0', 8384, 60],
  q_title_only: ['34718a4fab2177b11857424e1692f112f4c19d793f71c70eadcfb038e153215c', 11206, 4480], // a title-only text search keeps the predicate form (the candidate form read more on a name that matches most of the catalogue: its two sources overlap on every hit); ceiling = the 4,268 rows it reads at 6e8eed496 + 5 per cent. The earlier 3,120 was the candidate form.
  q_nothing: ['fe057055e890dbe518aa0da78e08378dcea953539f70223b09ea3d9e6649fdf6', 6309, 40],
  q_page_past_end: ['09b09900554807476e90addebb7470a19bb9b31023f4de6b8af6d6f4251a9b6c', 19401, 14420],
  branch1_in_stock: ['07d2d9223c8239d4a317b5b3a317ef5de2d21be8a2fb7e1596ba2c959797b519', 22193, 10730],
  branch2_out: ['87a7ac6269e391f3fe2a0c201da2a131370713db89c1eda7a705d47037d5f36b', 17411, 8710],
  low_stock: ['32cb264a525f209154bd380d002e852283584a0317fa5c4ccbb3b0df5d302433', 34640, 13770],
  brand_cat: ['88000fd37c496fc94935d73d15b2671f399fe81a60073c87202dea6b4b3733fe', 19195, 7870],
  grouped: ['088ef6538bef18053a801844a7a131bd03db184b3072335eb8e9fffb19158050', 10758, 5450],
  standalone: ['715f5bee7dbff6db16f21afe20819b8d888812c1fab6d881043f3f6d7472ba15', 15109, 7960],
  initial: ['800e1960a957255afc01a71e7303885b2830296b21454ea5bad45898444ed286', 18617, 9760],
  promoted: ['47fab09e420d866a84c07c729594505a0de3d861af53441349efe91d5462b6b8', 9010, 4370],
  discounted: ['c94c7507de51995dd9ba370711789ed99e6a4058b14a8bd36050612e8f8338c9', 6768, 2960],
  by_ids: ['3019fb31ba7a8b71e10fcbb888ce09773a648f5ae10e73f6153db852c1b0a27e', 4222, 120],
  by_ids_none: ['ae286f60d56af8f483ef3339d811940971b8c42cb53ec4df046ea413f7d33245', 7, 10],
  rank_ids: ['2caab9bcf91552a28c878af369303ed8b5d8a2e876979042a1af0daab60fb288', 484, 510],
  q_child_sku: ['b1ff8c7441f12b0ad2583d6d8536603ca1904e4180b610d3b4a5d7d3b7347cf5', 16804, 6790],
  q_blank_child: ['a16ae90401a94e4969d40ba64b9b16d448fb255bf0c30553336da4c738acdecb', 16732, 6670],
  browse_p2: ['5112ee1a887a09675668101584deffae8670fe747753db8aab013e45452bceaa', 19023, 9960],
  q_khmer: ['e00de30a4b91e9c5f8bea30a835763cdb4160d3768afa9380d6c41c85407037d', 8438, 120],
  q_khmer_serum: ['4d8e3f7297ebd0c0a6e0c5445a76acf9ce7bd23693fae422d7fd5686e9203f08', 12496, 4380],
  q_inactive_member: ['fe057055e890dbe518aa0da78e08378dcea953539f70223b09ea3d9e6649fdf6', 14583, 6550],
  q_inactive_parent_child: ['e0229781b88aa2d106998e6cbb9d960175c2005c2ecf1d37e76e307dff6b0bdb', 16790, 6770],
  by_ids_inactive: ['baa318bdadeea378fcf267bf681a8f57c6a38dc5d18aed55a4c6c417c79458b7', 4204, 110],
  q_retired: ['fe057055e890dbe518aa0da78e08378dcea953539f70223b09ea3d9e6649fdf6', 6315, 40],
  rank_ids_320: ['9c1e6cb6aeb29267ee7cf977d4fedf1aa6b5683f8367b168cb8ababc36d1248f', 9453, 6000],
  tie_name_asc_p19: ['6bf2a26a310c4d227c88e2d2dd89de92a12f6854e2c086a9b13182373b15a1d6', 18834, 9630],
  tie_name_asc_p20: ['57bdf838bbef156b15a5b987729e00b422f6a4372358864f41ef449e4104c416', 18791, 9560],
  tie_name_asc_p21: ['9a64b38321fa48d149fd5859a0541b78be604f41885915e89fbd4007530790a0', 18791, 9560],
  tie_name_asc_p22: ['9609cdf8f8687f973dc92c311256c82c0e8fce4847ec9d05c994c52aec062076', 19007, 9920],
  tie_name_desc_p73: ['be13871511e345b8a618d7612e54699408beab031e74c7ee85c153e0bb1aede9', 18951, 9830],
  tie_name_desc_p74: ['e5a16e0f8563e7772c804fc14592b6a7a8314a24553e08e2d0967f03bdbb0f29', 18791, 9560],
  tie_name_desc_p75: ['84bda336ff25bcb0ece9a2bd26fdc6209b0bf598d8e43dd805412484168816e8', 18791, 9560],
  tie_name_desc_p76: ['0d7bbc8a84628b659f3cc3b34518b8ced36ea606ba1293b83f48779648e5d0e6', 18751, 9420],
  tie_created_desc_p28: ['04235bea1968f8d54ed3ec944a910d80a5bd568f698f3cafcdd3c38e946101a8', 18818, 9620],
  tie_created_desc_p29: ['346976def4a24c5a2c2961286f0ec27fc1a699eda9811636634bf336910c0cc8', 18791, 9560],
  tie_created_desc_p30: ['761f4cc25283d8003ab589243e7b32e1b27f06b22186969a221cceba269ed6eb', 18791, 9560],
  tie_created_desc_p31: ['a2c6560a15e557e711ec831f634bb3fdff2a8d863e20f66e0b2efb31468826d1', 18963, 9860],
  tie_created_asc_p64: ['ff31089536e6a76e4bc884f07ce616e5ff3f679b2a5cb9a47b51ff7051deff7c', 18923, 9780],
  tie_created_asc_p65: ['7c4be5d2355cb9db61528333809117757ec642abf0e91ba28ae475f8b0432754', 18791, 9560],
  tie_created_asc_p66: ['c67eefb98b4a597983c9e1a4d7687d480afced8a1a772bbc34d0d266ec2f6374', 18791, 9560],
  tie_created_asc_p67: ['c6b9f803775967e2d764f57346a6ae795ab7f8aeb888d29f8b026667cffccb01', 18973, 9880],
  include_lots: ['7a959df3c56587a71507840d90dfb9ac9c37f7fafb4a014be951d776ac15108f', 18941, 9700],
  list: ['6ae039ac2de057cc3446b980776c34b95238c729c0f7b355a6a7d2019294c086', 20485, 13200],
  filters: ['1bb261d5c5f0bcd519344079a4e26511119b07fdc165d1ec7596b3aa5d957223', 20487, 21520],
  filters_pos_branch: ['1bb261d5c5f0bcd519344079a4e26511119b07fdc165d1ec7596b3aa5d957223', 20484, 21520],
  filters_stock_out: ['c14c2447c4f1768fbf2b84a1883d3509b045bc566099aae773e72667533a7eba', 14910, 15670],
  filters_cat_brand: ['d319788e1b5d59010ffc02ac85b2bde95068a634da11e921580c10a3e04345f5', 16245, 17070],
  filters_grouped: ['d80cc355ca8866e36537be78f281862d0b4cc0f9e5cf8a317c2d4f03ccb9ae13', 15706, 16500],
  bootstrap_pos: ['0bdcacfc73d801f6402a4ddf7fb3f11e8baff9661a363a8fdb2aa2fd39a319c1', 30047, 31550],
  q_cream_branch_stock: ['de0b62582fa3d6605fd4d0278a8ecdea4ad950d76626b83d8c7d624b4387cb76', 5505, 3410],
  q_cream_brand_promo: ['fe057055e890dbe518aa0da78e08378dcea953539f70223b09ea3d9e6649fdf6', 2598, 1090],
  q_cream_created_asc_p2: ['d84486f74687e37b3a8ef0093768100cc9e0ed711165a315c18dd1431e0f6746', 5057, 2640],
  q_substring: ['34718a4fab2177b11857424e1692f112f4c19d793f71c70eadcfb038e153215c', 4284, 2600], // raised from 2,340 (2,229 rows measured before): the id sources that skip the ids the word index matches (productSearchQuery.ts skippingFtsIds) cost one probe per trigram hit when the word index matches nothing, and save a repeated product probe on every word search. 2,470 rows now, base 4,284.
  q_barcode_fragment: ['1363b5e72856c4d64e579ef0e06a31ebd54dac3580c79a6f7a57a77f8167facc', 2884, 920], // raised from 870 by 50 for the same reason (871 rows now, base 2,884).
  q_upc_pair: ['fe057055e890dbe518aa0da78e08378dcea953539f70223b09ea3d9e6649fdf6', 2085, 40],
  rank_ids_320_p2: ['294a2f3a94880670b9a6956c96f779e577fd223b3adde184010095d8e00de3ac', 4961, 4880],
  rank_ids_child_only: ['ed9a86e9897b6959aef57a1b799caceeb741fccb897e4298f9205047060ba010', 5055, 4900],
  q_balm_promoted: ['be5e4d7e8bb21ddb8c8a0132f63f60052eb38b3254025f5b631f49f812515600', 6204, 3720],
  q_cream_rules: ['1a319309f2ba8ed1b5b37d019300c12486d071f3f89609f6817e4577783f0053', 4356, 2150],
  q_balm_discounted: ['c94c7507de51995dd9ba370711789ed99e6a4058b14a8bd36050612e8f8338c9', 5036, 2970],
  pos_text_48: ['3d4b294375da0679b75ae5bef573c253142468980a5d3a5738ee3786659f0f61', 6504, 3880],
  products_text_default: ['b8b316d65677d7d168c75c50a7b503699d1bea5bb9e428ef0502b12fc8d5d770', 15445, 10910],
  comma_or: ['5af76fdead187f4c579a30909eb2080e1493a03a878cf0e26af40b1c9f3151dd', 17872, 11880],
  rank_ids_1500_p16: ['b3c954c8d8013875aa9b559f2f77c7ff041706849f5cc32506158ecb8f32e780', 12283, 11330],
  q_upc_a: ['2c302633ae5e77d9c11f58a000bfd218e199aaff190350ca774449bf034a8e75', 2149, 110],
  q_upc_e: ['bdff6586c57519d3794ef5d379786fcad31ac7f124f7f9bffd7b2fd6aa7d84ae', 2149, 110],
  q_upc_short: ['57391b2ec654c239cc6e43b2d5e40f2708743e95adae09d823dc5d006b015804', 2243, 210],
  q_upc_ean: ['bdff6586c57519d3794ef5d379786fcad31ac7f124f7f9bffd7b2fd6aa7d84ae', 2149, 110],
  q_upc_a_branch: ['bdff6586c57519d3794ef5d379786fcad31ac7f124f7f9bffd7b2fd6aa7d84ae', 2149, 110],
  index_p0: ['48e0d34c2f90b1f50497180964d0ec2158232aed3a54d3843ed89ecdbf43850e', 3073, 1070],
  index_p1: ['aa3577679394938407abfc3e78b0f5f61163982b10ffb05d3d4dace2b801964a', 3121, 1120],
}

const PRINT = Boolean(process.env.PRINT_GOLDEN)
const root = path.resolve(__dirname, '..')
const COUNT_ONLY = /SELECT COUNT\(\*\) AS count FROM families/

async function main() {
  const world = await openWorld(catalogFixture(P, CUSTOMERS))
  try {
    const out = {}
    let hit
    for (const [label, route] of Object.entries(ALL_ROUTES)) {
      if (label === Object.keys(UPC_BATTERY)[0]) for (const [id, barcode] of Object.entries(UPC_ROWS)) await world.db.prepare('UPDATE products SET barcode = ? WHERE id = ?').bind(barcode, Number(id)).run()
      const r = await world.call(route)
      assert.equal(r.status, 200, `${label}: status ${r.status} ${r.text.slice(0, 200)}`)
      out[label] = r
      // Immediately: the page cache lives 20 seconds and the battery takes longer than that.
      if (label === 'browse') hit = await world.call(route)
      if (PRINT) console.log(`  '${label}': ['${sha(r.text)}', ${r.rows}],`)
    }
    if (PRINT) return

    // 1. Byte-identical to 04ab054cb, and cheaper than the ceiling for every shape.
    let oldTotal = 0, newTotal = 0
    for (const label of Object.keys(ALL_ROUTES)) {
      const [hash, oldRows, ceiling] = GOLDEN[label]
      assert.equal(sha(out[label].text), hash, `${label}: response differs from the 04ab054cb output`)
      assert.ok(out[label].rows <= ceiling, `${label}: ${out[label].rows} rows read, ceiling ${ceiling} (was ${oldRows} at 04ab054cb)`)
      oldTotal += oldRows
      newTotal += out[label].rows
    }
    assert.ok(newTotal < oldTotal * 0.53, `battery reads ${newTotal} rows, was ${oldTotal}; expected under 53 per cent`)
    console.log(`PASS ${Object.keys(ALL_ROUTES).length} responses byte-identical to 04ab054cb; rows read ${oldTotal} -> ${newTotal} (${Math.round(100 * newTotal / oldTotal)} per cent)`)
    for (const label of ['browse', 'browse_p3_50', 'created_desc', 'q_serum', 'q_multiword', 'q_child_sku', 'branch1_in_stock', 'low_stock', 'list', 'index_p0'])
      console.log(`MEASURE ${label}: ${GOLDEN[label][1]} -> ${out[label].rows}`)

    // 2. Statement shape: page one is one family statement (the count rides the page), keyed row fetch present;
    // only a page past the end still counts separately.
    const familyStatements = log => log.filter(entry => /page_candidates|FROM families/.test(entry.sql))
    assert.equal(familyStatements(out.browse.log).length, 1, 'page 1 reads the families in ONE statement')
    assert.ok(/page_candidates/.test(familyStatements(out.browse.log)[0].sql), 'the page rows are fetched by key')
    assert.equal(out.browse.log.filter(entry => COUNT_ONLY.test(entry.sql)).length, 0, 'no separate COUNT on a page that has rows')
    assert.equal(out.browse_past_end.log.filter(entry => COUNT_ONLY.test(entry.sql)).length, 1, 'a page past the end still counts, once')
    assert.equal(JSON.parse(out.browse_past_end.text).total, JSON.parse(out.browse.text).total, 'past-end total equals the first page total')
    assert.equal(JSON.parse(out.q_nothing.text).total, 0, 'an empty first page means total 0 without a second statement')
    assert.equal(out.q_nothing.log.filter(entry => COUNT_ONLY.test(entry.sql)).length, 0)
    assert.ok(!out.rank_ids.log.some(entry => /page_candidates/.test(entry.sql)), 'an 8-id ranked hydration keeps the default statements (till latency)')
    assert.ok(!out.by_ids.log.some(entry => /page_candidates/.test(entry.sql)), 'a by-id read keeps the default statements')
    assert.ok(out.rank_ids_320.log.some(entry => /page_candidates/.test(entry.sql)), 'a 320-id ranked read uses the keyed page fetch')
    console.log('PASS one family statement per page; count only when the page is past the end')

    // 2b. Typed text and long ranked-id lists rank from the ids the search names (__cand), so the catalogue is not walked to test the search predicate on every product: a search that
    // matches little reads little (before, every typed search read every active product: ~2,000 rows here whatever the text matched). Searches with a hybrid, short-word or partial-word
    // term (several words, one or two letters) keep the predicate form.
    const candidateStatements = log => log.filter(entry => /\b__cand\b/.test(entry.sql))
    for (const label of ['q_serum', 'q_serum_p2', 'q_barcode', 'q_khmer', 'q_nothing', 'q_retired', 'q_page_past_end', 'rank_ids_320', 'q_substring', 'q_balm_promoted', 'pos_text_48', 'products_text_default', 'rank_ids_1500_p16', 'comma_or', 'q_upc_a', 'q_upc_e', 'q_upc_short'])
      assert.ok(candidateStatements(out[label].log).length >= 1, `${label} ranks from its candidate ids`)
    for (const label of ['q_title_only', 'q_multiword', 'q_child_sku', 'q_blank_child', 'q_khmer_serum', 'browse', 'by_ids', 'rank_ids'])
      assert.equal(candidateStatements(out[label].log).length, 0, `${label} keeps the predicate form`)
    assert.ok(out.q_nothing.rows < 60 && out.q_barcode.rows < 100 && out.q_khmer.rows < 200, `a search that matches little reads little: ${out.q_nothing.rows}, ${out.q_barcode.rows}, ${out.q_khmer.rows}`)
    assert.ok(out.q_serum.rows < 0.8 * GOLDEN.q_serum[1], 'a common word reads far less than the 04ab054cb statement')
    // The new shapes return rows (an empty body pins nothing but "no rows"), and a UPC scan returns exactly the UPC-A and UPC-E rows, never the short or EAN-13 spelling of the same digits.
    for (const label of ['q_balm_promoted', 'q_cream_rules', 'q_balm_discounted', 'pos_text_48', 'products_text_default', 'comma_or', 'rank_ids_1500_p16', 'q_upc_a', 'q_upc_short'])
      assert.ok(JSON.parse(out[label].text).items.length > 0, `${label} returns rows`)
    const idsOf = label => JSON.parse(out[label].text).items.map(item => item.id).sort((a, b) => a - b)
    assert.deepEqual(idsOf('q_upc_a'), [1020, 1021], 'a UPC-A scan finds the UPC-A and its UPC-E, not the short or EAN-13 spelling')
    assert.deepEqual(idsOf('q_upc_e'), [1020, 1021], 'a UPC-E scan finds the same two rows')
    assert.deepEqual(idsOf('q_upc_a_branch'), [1020, 1021])
    assert.ok(idsOf('q_upc_short').includes(1022) && !idsOf('q_upc_short').includes(1021), 'the 11-digit text is not a UPC scan')
    console.log(`PASS typed searches rank from candidate ids; nothing ${out.q_nothing.rows} rows, barcode ${out.q_barcode.rows}, Khmer ${out.q_khmer.rows}, "serum" ${out.q_serum.rows}`)

    // 3. A cache hit does not re-run the page query and returns the same bytes.
    assert.equal(hit.text, out.browse.text, 'cache hit is byte-identical to the miss')
    assert.equal(familyStatements(hit.log).length, 0, 'cache hit does not run the family statement')
    assert.ok(hit.rows < 600, `cache hit read ${hit.rows} rows`)
    console.log(`PASS cache hit: ${hit.rows} rows (live rows and stock for the 20-row page only)`)

    // 4. search-index: a primary-key range, so a 1,000-id page reads about 1,000 rows, never the whole catalogue.
    for (const label of ['index_p0', 'index_p1']) assert.ok(out[label].rows <= 1100, `${label} read ${out[label].rows} rows`)
    const planned = await world.probeSql("EXPLAIN QUERY PLAN SELECT id, name, brand, category, barcode, sku FROM products WHERE id >= 1000 AND id < 3000 AND +products.is_active = 1 ORDER BY id")
    assert.ok(planned.results.some(row => /PRIMARY KEY \(rowid>\? AND rowid<\?\)/.test(row.detail)), 'the index page is a rowid range')
    const indexed = await world.probeSql('SELECT id, name, brand, category, barcode, sku FROM products WHERE id >= 1000 AND id < 3000 AND products.is_active = 1 ORDER BY id')
    const pinned = await world.probeSql('SELECT id, name, brand, category, barcode, sku FROM products WHERE id >= 1000 AND id < 3000 AND +products.is_active = 1 ORDER BY id')
    assert.equal(JSON.stringify(pinned.results), JSON.stringify(indexed.results), 'same rows, same order')
    assert.ok(indexed.rows > pinned.rows * 1.5, `the indexed predicate reads ${indexed.rows} rows, the pinned one ${pinned.rows}`)
    console.log(`PASS search-index page: pinned ${pinned.rows} rows vs ${indexed.rows} with the indexed predicate`)

    // 5. Customer picker (GET /api/customers?fields=sales_picker). Until 11 Nov no index served ORDER BY lower(name), so the
    // empty picker read the table twice (scan + sort: >= 2 x customers). Migration 0303 (d1-queries S8) added the partial index
    // idx_customers_sales_picker ON customers (lower(name), id) WHERE COALESCE(is_anonymous, 0) = 0, so the empty search now walks
    // the index and stops at LIMIT: one row per item, 50 by default. This guards the NEW cost as a ceiling (a page of rows, never a
    // fraction of the table) and proves the ceiling is the index's doing by dropping it on the lab database: the same call must
    // then read the table twice again, with the same bytes. If the picker's WHERE term drifts from the index predicate, the planner
    // stops using the index and the first assertion goes red.
    const PICKER_LIMIT = 50
    const picker = await world.call('/api/customers?fields=sales_picker')
    assert.equal(picker.status, 200)
    assert.ok(picker.rows <= PICKER_LIMIT * 2, `the empty picker must walk idx_customers_sales_picker and stop at LIMIT: ${picker.rows} rows read for ${CUSTOMERS} customers (ceiling ${PICKER_LIMIT * 2})`)
    await world.db.prepare('DROP INDEX idx_customers_sales_picker').run()
    const unindexedPicker = await world.call('/api/customers?fields=sales_picker')
    assert.equal(unindexedPicker.text, picker.text, 'the partial index changes no byte of the picker')
    assert.ok(unindexedPicker.rows >= CUSTOMERS * 2, `control: without the index the picker reads the table twice (${unindexedPicker.rows} rows for ${CUSTOMERS} customers)`)
    assert.ok(picker.rows * 20 < unindexedPicker.rows, `with the index the picker reads ${picker.rows} rows, not ${unindexedPicker.rows}`)
    console.log(`MEASURE customers sales_picker, ${CUSTOMERS} customers: ${unindexedPicker.rows} rows without idx_customers_sales_picker -> ${picker.rows} with it`)
    console.log('PASS the 0303 partial index makes the empty customer picker a LIMIT-sized read, byte-identical')

    // 6. Source guards.
    const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
    const products = read('src/routes/products.ts')
    assert.equal((products.match(/seekPage: seekPageRead/g) || []).length, 1, 'only the product search opts in')
    assert.ok(/catalogProductSql\('products', false\)\} ORDER BY id/.test(products), 'search-index pins the primary-key range')
    assert.equal((products.match(/candidateSql: candidateRead\?\.idsSql/g) || []).length, 1, 'only the product search hands the ranking a candidate list')
    for (const rel of ['src/routes/inventory.ts', 'src/routes/branches.ts', 'src/routes/portal.ts', 'src/lib/inventoryCheckProducts.ts'])
      assert.ok(!/seekPage|candidateSql/.test(read(rel)), `${rel} keeps the default pagination statements`)
    console.log('PASS source guards')
  } finally { await world.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
