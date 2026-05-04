import { getPortalLanguageText } from './portalLanguagePacks.mjs'

const TRANSLATABLE_CONFIG_FIELDS = [
  'aboutTitle',
  'aboutContent',
  'aiTitle',
  'aiIntro',
  'aiDisclaimer',
  'faqTitle',
  'membershipInfoText',
  'submissionInstructions',
]

const DEFAULT_CONFIG_COPY_KEYS = {
  aboutTitle: ['About us', 'aboutTitle'],
  aiTitle: ['Beauty Assistant', 'aiTitle'],
  aiIntro: ['Tell us what you are shopping for and the assistant will suggest products from Leang Cosmetics.', 'aiIntro'],
  aiDisclaimer: ['AI generated, for reference only. For more accurate inquiries, please contact our store on Instagram or Facebook.', 'aiDisclaimer'],
  faqTitle: ['Frequently asked questions', 'faqTitle'],
}

const PRODUCT_TRANSLATABLE_FIELDS = [
  'name',
  'description',
  'category',
  'brand',
]

const DEFAULT_FAQ_TEXT_BY_LANGUAGE = {
  'zh-CN': {
    'How do I choose products for my skin type?': '如何根据我的肤质选择产品？',
    'Tell us your skin type, concerns, and what kind of routine you want. We can recommend suitable skincare, cosmetics, hair, or body products from our available stock.': '告诉我们你的肤质、护理困扰和想要的日常步骤。我们会从现有库存中推荐合适的护肤、彩妆、护发或身体护理产品。',
    'Are the products shown here available in store?': '这里显示的产品店里有货吗？',
    'The portal reads from our current Business OS catalog. Stock can still change during busy periods, so please contact the store if you need a final confirmation before visiting.': '本页面读取当前 Business OS 商品目录。繁忙时库存可能变化，到店前如需最终确认，请联系门店。',
    'How do I check my membership points?': '如何查询我的会员积分？',
    'Open the Membership section, enter your membership number, and you can review purchase history, returns, and current points from your customer account.': '打开会员页面，输入会员编号，即可查看购买记录、退货记录和当前积分。',
    'How does Share & Reward work?': '分享奖励如何运作？',
    'Share our store on social media, upload your screenshot in the portal, and our staff will review it. Approved submissions can receive reward points in your membership account.': '在社交媒体分享本店后，在页面上传截图，工作人员会进行审核。通过后奖励积分会加入你的会员账户。',
    'How can I contact Leang Cosmetics for more accurate advice?': '如何联系 Leang Cosmetics 获得更准确的建议？',
    'Use the social links on this page or call the store directly. Our team can help with product matching, stock checks, and more specific skincare or makeup questions.': '你可以使用本页的社交链接或直接致电门店。团队可以协助产品匹配、库存确认，以及更具体的护肤或彩妆问题。',
    'Do you have products for sensitive skin?': '有适合敏感肌的产品吗？',
    'Yes. Ask our team or use the AI assistant with your skin type and concerns so we can narrow options that are gentler and easier to compare from current stock.': '有。请告诉团队或 AI 助手你的肤质和困扰，我们会从现有库存中筛选更温和、便于比较的选项。',
    'Can I ask whether a product is original or from a specific brand line?': '可以询问产品是否正品或属于某个品牌系列吗？',
    'Yes. Contact the store directly if you want brand confirmation, latest packaging details, or a more exact stock check before buying.': '可以。购买前如需品牌确认、最新包装信息或更准确库存，请直接联系门店。',
    'Do you sell skincare, makeup, hair care, and body care together?': '你们同时销售护肤、彩妆、护发和身体护理吗？',
    'Yes. Leang Cosmetics carries multiple beauty categories, so you can search the catalog or ask for recommendations across skincare, cosmetics, perfume, hair, and body products.': '是的。Leang Cosmetics 提供多个美妆品类，你可以搜索目录，或询问护肤、彩妆、香水、护发和身体护理产品推荐。',
    'Can the store help me build a full routine?': '门店可以帮我搭配完整护理流程吗？',
    'Yes. Share your budget, skin type, concerns, and whether you need morning, night, or event-based products. We can help match a more complete routine from available products.': '可以。请说明预算、肤质、困扰，以及需要早间、夜间或活动场景产品。我们会从现有产品中帮你搭配更完整的方案。',
    'What should I do if an item is out of stock?': '商品缺货时该怎么办？',
    'If an item is unavailable, message the store through Facebook, Instagram, Telegram, or phone so the team can suggest alternatives or confirm when stock changes.': '如果商品暂时缺货，请通过 Facebook、Instagram、Telegram 或电话联系门店，团队会推荐替代品或确认补货变化。',
    'Can I ask for products within a specific budget?': '可以按指定预算推荐产品吗？',
    'Yes. Tell us your budget and what category you want, and we can narrow options from the current catalog.': '可以。告诉我们你的预算和想要的品类，我们会从当前目录中缩小选择范围。',
    'Do you have gift-friendly items or bundles?': '有适合送礼的产品或套装吗？',
    'Yes. Ask the store team or use the assistant to explore perfumes, makeup, skincare, and beauty gifts that fit the occasion.': '有。可以询问门店团队或使用助手，查找适合场合的香水、彩妆、护肤和美妆礼品。',
    'Can I ask for alternatives if my preferred brand is unavailable?': '如果喜欢的品牌没货，可以推荐替代品吗？',
    'Yes. We can suggest similar products from other brands in stock based on category, concern, and price range.': '可以。我们会根据品类、需求和价格范围，推荐库存中其他品牌的相似产品。',
    'Can I check whether a product is suitable for oily, dry, or combination skin?': '可以确认产品是否适合油性、干性或混合性皮肤吗？',
    'Yes. Use the assistant or contact the store with your skin type and concern so recommendations stay closer to your needs.': '可以。请通过助手或联系门店说明肤质和困扰，这样推荐会更贴近你的需要。',
    'Do you also carry hair, body, and fragrance products?': '你们也有护发、身体护理和香氛产品吗？',
    'Yes. The store carries more than just skincare and makeup, so you can also browse hair, body, perfume, and related beauty items when available.': '有。门店不只销售护肤和彩妆，也可以浏览护发、身体护理、香水和相关美妆产品。',
    'What details help the AI recommend better products?': '哪些信息能帮助 AI 推荐更合适的产品？',
    'Does the AI only recommend products available at Leang Cosmetics?': 'AI 只会推荐 Leang Cosmetics 有售的产品吗？',
    'Should I trust the AI as medical or skin-treatment advice?': 'AI 可以作为医疗或皮肤治疗建议吗？',
    'Why does the assistant sometimes suggest several options instead of one product?': '为什么助手有时会推荐多个选项而不是一个产品？',
    'Can the assistant explain why a product was recommended?': '助手能解释为什么推荐某个产品吗？',
  },
}

const FAQ_VOCABULARY_BY_LANGUAGE = {
  'zh-CN': {
    'sensitive skin': '敏感肌',
    'skin type': '肤质',
    products: '产品',
    product: '产品',
    membership: '会员',
    points: '积分',
    stock: '库存',
    alternatives: '替代品',
    alternative: '替代品',
    budget: '预算',
    price: '价格',
    skincare: '护肤',
    makeup: '彩妆',
    hair: '护发',
    body: '身体护理',
    fragrance: '香氛',
    perfume: '香水',
    brand: '品牌',
    store: '门店',
    recommendations: '推荐',
    recommend: '推荐',
  },
  'zh-TW': {
    'sensitive skin': '敏感肌',
    'skin type': '膚質',
    products: '產品',
    product: '產品',
    membership: '會員',
    points: '點數',
    stock: '庫存',
    alternatives: '替代品',
    alternative: '替代品',
    budget: '預算',
    price: '價格',
    skincare: '保養',
    makeup: '彩妝',
    hair: '護髮',
    body: '身體保養',
    fragrance: '香氛',
    perfume: '香水',
    brand: '品牌',
    store: '門市',
    recommendations: '推薦',
    recommend: '推薦',
  },
  km: {
    'sensitive skin': 'ស្បែកងាយប្រតិកម្ម',
    'skin type': 'ប្រភេទស្បែក',
    products: 'ផលិតផល',
    product: 'ផលិតផល',
    membership: 'សមាជិក',
    points: 'ពិន្ទុ',
    stock: 'ស្តុក',
    alternatives: 'ជម្រើសជំនួស',
    alternative: 'ជម្រើសជំនួស',
    budget: 'ថវិកា',
    price: 'តម្លៃ',
    skincare: 'ថែរក្សាស្បែក',
    makeup: 'គ្រឿងសម្អាង',
    hair: 'សក់',
    body: 'រាងកាយ',
    fragrance: 'ក្លិនក្រអូប',
    perfume: 'ទឹកអប់',
    brand: 'ម៉ាក',
    store: 'ហាង',
    recommendations: 'ការណែនាំ',
    recommend: 'ណែនាំ',
  },
  vi: { products: 'sản phẩm', product: 'sản phẩm', membership: 'thành viên', points: 'điểm', stock: 'tồn kho', budget: 'ngân sách', price: 'giá', skincare: 'chăm sóc da', makeup: 'trang điểm', brand: 'thương hiệu', store: 'cửa hàng' },
  th: { products: 'สินค้า', product: 'สินค้า', membership: 'สมาชิก', points: 'คะแนน', stock: 'สต็อก', budget: 'งบประมาณ', price: 'ราคา', skincare: 'สกินแคร์', makeup: 'เมคอัพ', brand: 'แบรนด์', store: 'ร้าน' },
  ru: { products: 'товары', product: 'товар', membership: 'клиентская карта', points: 'баллы', stock: 'наличие', budget: 'бюджет', price: 'цена', skincare: 'уход за кожей', makeup: 'макияж', brand: 'бренд', store: 'магазин' },
  fr: { products: 'produits', product: 'produit', membership: 'fidélité', points: 'points', stock: 'stock', budget: 'budget', price: 'prix', skincare: 'soins de la peau', makeup: 'maquillage', brand: 'marque', store: 'boutique' },
  es: { products: 'productos', product: 'producto', membership: 'membresía', points: 'puntos', stock: 'stock', budget: 'presupuesto', price: 'precio', skincare: 'cuidado de la piel', makeup: 'maquillaje', brand: 'marca', store: 'tienda' },
  de: { products: 'Produkte', product: 'Produkt', membership: 'Mitgliedschaft', points: 'Punkte', stock: 'Bestand', budget: 'Budget', price: 'Preis', skincare: 'Hautpflege', makeup: 'Make-up', brand: 'Marke', store: 'Geschäft' },
  ja: { products: '商品', product: '商品', membership: '会員', points: 'ポイント', stock: '在庫', budget: '予算', price: '価格', skincare: 'スキンケア', makeup: 'メイク', brand: 'ブランド', store: '店舗' },
  ko: { products: '제품', product: '제품', membership: '멤버십', points: '포인트', stock: '재고', budget: '예산', price: '가격', skincare: '스킨케어', makeup: '메이크업', brand: '브랜드', store: '매장' },
  pt: { products: 'produtos', product: 'produto', membership: 'fidelidade', points: 'pontos', stock: 'estoque', budget: 'orçamento', price: 'preço', skincare: 'cuidados com a pele', makeup: 'maquiagem', brand: 'marca', store: 'loja' },
  it: { products: 'prodotti', product: 'prodotto', membership: 'fedeltà', points: 'punti', stock: 'stock', budget: 'budget', price: 'prezzo', skincare: 'cura della pelle', makeup: 'trucco', brand: 'marchio', store: 'negozio' },
  ar: { products: 'المنتجات', product: 'منتج', membership: 'العضوية', points: 'النقاط', stock: 'المخزون', budget: 'الميزانية', price: 'السعر', skincare: 'العناية بالبشرة', makeup: 'المكياج', brand: 'العلامة', store: 'المتجر' },
  hi: { products: 'उत्पाद', product: 'उत्पाद', membership: 'सदस्यता', points: 'अंक', stock: 'स्टॉक', budget: 'बजट', price: 'कीमत', skincare: 'स्किनकेयर', makeup: 'मेकअप', brand: 'ब्रांड', store: 'स्टोर' },
  id: { products: 'produk', product: 'produk', membership: 'keanggotaan', points: 'poin', stock: 'stok', budget: 'anggaran', price: 'harga', skincare: 'perawatan kulit', makeup: 'makeup', brand: 'merek', store: 'toko' },
  ms: { products: 'produk', product: 'produk', membership: 'keahlian', points: 'mata', stock: 'stok', budget: 'bajet', price: 'harga', skincare: 'penjagaan kulit', makeup: 'solekan', brand: 'jenama', store: 'kedai' },
  tr: { products: 'ürünler', product: 'ürün', membership: 'üyelik', points: 'puan', stock: 'stok', budget: 'bütçe', price: 'fiyat', skincare: 'cilt bakımı', makeup: 'makyaj', brand: 'marka', store: 'mağaza' },
}

const DEFAULT_FAQ_QUESTION_TRANSLATIONS_BY_LANGUAGE = {
  km: {
    'How do I choose products for my skin type?': 'តើខ្ញុំគួរជ្រើសរើសផលិតផលសម្រាប់ប្រភេទស្បែករបស់ខ្ញុំដោយរបៀបណា?',
    'Tell us your skin type, concerns, and what kind of routine you want. We can recommend suitable skincare, cosmetics, hair, or body products from our available stock.': 'ប្រាប់យើងពីប្រភេទស្បែក បញ្ហាស្បែក និងរបៀបថែរក្សាដែលអ្នកចង់បាន។ យើងអាចណែនាំផលិតផលថែរក្សាស្បែក គ្រឿងសម្អាង សក់ ឬរាងកាយដែលសមស្របពីស្តុកបច្ចុប្បន្ន។',
    'Are the products shown here available in store?': 'តើផលិតផលដែលបង្ហាញនៅទីនេះមាននៅហាងដែរឬទេ?',
    'The portal reads from our current Business OS catalog. Stock can still change during busy periods, so please contact the store if you need a final confirmation before visiting.': 'ទំព័រនេះអានពីកាតាឡុក Business OS បច្ចុប្បន្ន។ ស្តុកអាចផ្លាស់ប្តូរនៅពេលរវល់ ដូច្នេះសូមទាក់ទងហាង ប្រសិនបើអ្នកត្រូវការបញ្ជាក់ចុងក្រោយមុនទៅហាង។',
    'How do I check my membership points?': 'តើខ្ញុំអាចពិនិត្យពិន្ទុសមាជិកភាពរបស់ខ្ញុំដោយរបៀបណា?',
    'Open the Membership section, enter your membership number, and you can review purchase history, returns, and current points from your customer account.': 'បើកផ្នែកសមាជិកភាព បញ្ចូលលេខសមាជិករបស់អ្នក ហើយអ្នកអាចមើលប្រវត្តិទិញ ការត្រឡប់ និងពិន្ទុបច្ចុប្បន្នពីគណនីអតិថិជន។',
    'What should I do if an item is out of stock?': 'តើខ្ញុំគួរធ្វើដូចម្តេច ប្រសិនបើទំនិញអស់ស្តុក?',
    'If an item is unavailable, message the store through Facebook, Instagram, Telegram, or phone so the team can suggest alternatives or confirm when stock changes.': 'ប្រសិនបើទំនិញមិនមាន សូមផ្ញើសារទៅហាងតាម Facebook, Instagram, Telegram ឬទូរស័ព្ទ ដើម្បីឱ្យក្រុមការងារណែនាំជម្រើសជំនួស ឬបញ្ជាក់ពេលស្តុកផ្លាស់ប្តូរ។',
  },
  'zh-CN': {
    'How do I choose products for my skin type?': '如何根据我的肤质选择产品？',
    'Are the products shown here available in store?': '这里显示的产品店里有货吗？',
    'How do I check my membership points?': '如何查询我的会员积分？',
    'What should I do if an item is out of stock?': '商品缺货时该怎么办？',
  },
  'zh-TW': {
    'How do I choose products for my skin type?': '如何依照我的膚質選擇產品？',
    'Are the products shown here available in store?': '這裡顯示的產品門市有貨嗎？',
    'How do I check my membership points?': '如何查詢我的會員點數？',
    'What should I do if an item is out of stock?': '商品缺貨時該怎麼辦？',
  },
  vi: {
    'How do I choose products for my skin type?': 'Làm sao chọn sản phẩm phù hợp với loại da của tôi?',
    'Are the products shown here available in store?': 'Các sản phẩm hiển thị ở đây có sẵn tại cửa hàng không?',
    'How do I check my membership points?': 'Làm sao kiểm tra điểm thành viên của tôi?',
    'What should I do if an item is out of stock?': 'Tôi nên làm gì nếu sản phẩm hết hàng?',
  },
  th: {
    'How do I choose products for my skin type?': 'ฉันจะเลือกสินค้าสำหรับสภาพผิวของฉันได้อย่างไร?',
    'Are the products shown here available in store?': 'สินค้าที่แสดงอยู่ที่นี่มีที่ร้านหรือไม่?',
    'How do I check my membership points?': 'ฉันจะตรวจสอบคะแนนสมาชิกได้อย่างไร?',
    'What should I do if an item is out of stock?': 'ถ้าสินค้าหมดสต็อกควรทำอย่างไร?',
  },
  ru: {
    'How do I choose products for my skin type?': 'Как выбрать товары для моего типа кожи?',
    'Are the products shown here available in store?': 'Есть ли показанные здесь товары в магазине?',
    'How do I check my membership points?': 'Как проверить мои бонусные баллы?',
    'What should I do if an item is out of stock?': 'Что делать, если товара нет в наличии?',
  },
  fr: {
    'How do I choose products for my skin type?': 'Comment choisir des produits adaptés à mon type de peau ?',
    'Are the products shown here available in store?': 'Les produits affichés ici sont-ils disponibles en boutique ?',
    'How do I check my membership points?': 'Comment consulter mes points de fidélité ?',
    'What should I do if an item is out of stock?': 'Que faire si un article est en rupture de stock ?',
  },
  es: {
    'How do I choose products for my skin type?': '¿Cómo elijo productos para mi tipo de piel?',
    'Are the products shown here available in store?': '¿Los productos que se muestran aquí están disponibles en tienda?',
    'How do I check my membership points?': '¿Cómo reviso mis puntos de membresía?',
    'What should I do if an item is out of stock?': '¿Qué hago si un artículo está agotado?',
  },
  de: {
    'How do I choose products for my skin type?': 'Wie wähle ich Produkte für meinen Hauttyp aus?',
    'Are the products shown here available in store?': 'Sind die hier gezeigten Produkte im Geschäft verfügbar?',
    'How do I check my membership points?': 'Wie prüfe ich meine Mitgliedspunkte?',
    'What should I do if an item is out of stock?': 'Was soll ich tun, wenn ein Artikel nicht vorrätig ist?',
  },
  ja: {
    'How do I choose products for my skin type?': '自分の肌タイプに合う商品はどう選べばよいですか？',
    'Are the products shown here available in store?': 'ここに表示されている商品は店舗で購入できますか？',
    'How do I check my membership points?': '会員ポイントはどう確認できますか？',
    'What should I do if an item is out of stock?': '商品が在庫切れの場合はどうすればよいですか？',
  },
  ko: {
    'How do I choose products for my skin type?': '제 피부 타입에 맞는 제품은 어떻게 고르나요?',
    'Are the products shown here available in store?': '여기에 표시된 제품은 매장에서 구매할 수 있나요?',
    'How do I check my membership points?': '멤버십 포인트는 어떻게 확인하나요?',
    'What should I do if an item is out of stock?': '상품이 품절이면 어떻게 해야 하나요?',
  },
  pt: {
    'How do I choose products for my skin type?': 'Como escolher produtos para o meu tipo de pele?',
    'Are the products shown here available in store?': 'Os produtos mostrados aqui estão disponíveis na loja?',
    'How do I check my membership points?': 'Como consulto meus pontos de fidelidade?',
    'What should I do if an item is out of stock?': 'O que devo fazer se um item estiver sem estoque?',
  },
  it: {
    'How do I choose products for my skin type?': 'Come scelgo prodotti per il mio tipo di pelle?',
    'Are the products shown here available in store?': 'I prodotti mostrati qui sono disponibili in negozio?',
    'How do I check my membership points?': 'Come controllo i miei punti fedeltà?',
    'What should I do if an item is out of stock?': 'Cosa devo fare se un articolo è esaurito?',
  },
  ar: {
    'How do I choose products for my skin type?': 'كيف أختار المنتجات المناسبة لنوع بشرتي؟',
    'Are the products shown here available in store?': 'هل المنتجات المعروضة هنا متوفرة في المتجر؟',
    'How do I check my membership points?': 'كيف أتحقق من نقاط عضويتي؟',
    'What should I do if an item is out of stock?': 'ماذا أفعل إذا كان المنتج غير متوفر؟',
  },
  hi: {
    'How do I choose products for my skin type?': 'मैं अपनी त्वचा के प्रकार के लिए उत्पाद कैसे चुनूं?',
    'Are the products shown here available in store?': 'क्या यहां दिखाए गए उत्पाद स्टोर में उपलब्ध हैं?',
    'How do I check my membership points?': 'मैं अपने सदस्यता अंक कैसे जांचूं?',
    'What should I do if an item is out of stock?': 'अगर कोई आइटम स्टॉक में नहीं है तो मुझे क्या करना चाहिए?',
  },
  id: {
    'How do I choose products for my skin type?': 'Bagaimana memilih produk untuk jenis kulit saya?',
    'Are the products shown here available in store?': 'Apakah produk yang ditampilkan di sini tersedia di toko?',
    'How do I check my membership points?': 'Bagaimana cara memeriksa poin keanggotaan saya?',
    'What should I do if an item is out of stock?': 'Apa yang harus saya lakukan jika barang habis stok?',
  },
  ms: {
    'How do I choose products for my skin type?': 'Bagaimana saya memilih produk untuk jenis kulit saya?',
    'Are the products shown here available in store?': 'Adakah produk yang dipaparkan di sini tersedia di kedai?',
    'How do I check my membership points?': 'Bagaimana saya menyemak mata keahlian saya?',
    'What should I do if an item is out of stock?': 'Apa yang perlu saya buat jika item kehabisan stok?',
  },
  tr: {
    'How do I choose products for my skin type?': 'Cilt tipime uygun ürünleri nasıl seçerim?',
    'Are the products shown here available in store?': 'Burada gösterilen ürünler mağazada mevcut mu?',
    'How do I check my membership points?': 'Üyelik puanlarımı nasıl kontrol ederim?',
    'What should I do if an item is out of stock?': 'Bir ürün stokta yoksa ne yapmalıyım?',
  },
}

Object.entries(DEFAULT_FAQ_QUESTION_TRANSLATIONS_BY_LANGUAGE).forEach(([language, textByEnglish]) => {
  DEFAULT_FAQ_TEXT_BY_LANGUAGE[language] = {
    ...(DEFAULT_FAQ_TEXT_BY_LANGUAGE[language] || {}),
    ...textByEnglish,
  }
})

const FAQ_VOCABULARY_EXTENSIONS_BY_LANGUAGE = {
  km: {
    'available in store': 'មាននៅហាង',
    'membership points': 'ពិន្ទុសមាជិកភាព',
    'purchase history': 'ប្រវត្តិទិញ',
    'out of stock': 'អស់ស្តុក',
    'specific budget': 'ថវិកាជាក់លាក់',
    concerns: 'បញ្ហាស្បែក',
    routine: 'របៀបថែរក្សា',
    cosmetics: 'គ្រឿងសម្អាង',
    'hair care': 'ការថែសក់',
    'body care': 'ការថែទាំរាងកាយ',
    available: 'មាន',
    unavailable: 'មិនមាន',
    category: 'ប្រភេទ',
    categories: 'ប្រភេទ',
    branch: 'សាខា',
    item: 'ទំនិញ',
    items: 'ទំនិញ',
    assistant: 'ជំនួយការ',
    advice: 'ការណែនាំ',
    medical: 'វេជ្ជសាស្ត្រ',
    allergies: 'អាឡែហ្ស៊ី',
    oily: 'ស្បែកខ្លាញ់',
    dry: 'ស្បែកស្ងួត',
    combination: 'ស្បែកចម្រុះ',
    suitable: 'សមស្រប',
    contact: 'ទាក់ទង',
    phone: 'ទូរស័ព្ទ',
  },
  vi: {
    'available in store': 'có sẵn tại cửa hàng',
    'membership points': 'điểm thành viên',
    'purchase history': 'lịch sử mua hàng',
    'out of stock': 'hết hàng',
    'specific budget': 'ngân sách cụ thể',
    'sensitive skin': 'da nhạy cảm',
    'skin type': 'loại da',
    concerns: 'vấn đề da',
    routine: 'quy trình chăm sóc',
    alternatives: 'lựa chọn thay thế',
    recommendations: 'gợi ý',
  },
  th: {
    'available in store': 'มีที่ร้าน',
    'membership points': 'คะแนนสมาชิก',
    'purchase history': 'ประวัติการซื้อ',
    'out of stock': 'หมดสต็อก',
    'specific budget': 'งบประมาณที่กำหนด',
    'sensitive skin': 'ผิวแพ้ง่าย',
    'skin type': 'สภาพผิว',
    concerns: 'ปัญหาผิว',
    routine: 'รูทีน',
    alternatives: 'ตัวเลือกทดแทน',
    recommendations: 'คำแนะนำ',
  },
  ru: {
    'available in store': 'доступно в магазине',
    'membership points': 'бонусные баллы',
    'purchase history': 'история покупок',
    'out of stock': 'нет в наличии',
    'specific budget': 'конкретный бюджет',
    'sensitive skin': 'чувствительная кожа',
    'skin type': 'тип кожи',
    concerns: 'проблемы кожи',
    routine: 'уход',
    alternatives: 'альтернативы',
    recommendations: 'рекомендации',
  },
  fr: {
    'available in store': 'disponible en boutique',
    'membership points': 'points de fidélité',
    'purchase history': 'historique d’achat',
    'out of stock': 'en rupture de stock',
    'specific budget': 'budget précis',
    'sensitive skin': 'peau sensible',
    'skin type': 'type de peau',
    concerns: 'préoccupations',
    routine: 'routine',
    alternatives: 'alternatives',
    recommendations: 'recommandations',
  },
  es: {
    'available in store': 'disponible en tienda',
    'membership points': 'puntos de membresía',
    'purchase history': 'historial de compras',
    'out of stock': 'agotado',
    'specific budget': 'presupuesto específico',
    'sensitive skin': 'piel sensible',
    'skin type': 'tipo de piel',
    concerns: 'preocupaciones',
    routine: 'rutina',
    alternatives: 'alternativas',
    recommendations: 'recomendaciones',
  },
  de: {
    'available in store': 'im Geschäft verfügbar',
    'membership points': 'Mitgliedspunkte',
    'purchase history': 'Kaufverlauf',
    'out of stock': 'nicht vorrätig',
    'specific budget': 'bestimmtes Budget',
    'sensitive skin': 'empfindliche Haut',
    'skin type': 'Hauttyp',
    concerns: 'Hautprobleme',
    routine: 'Routine',
    alternatives: 'Alternativen',
    recommendations: 'Empfehlungen',
  },
  ja: {
    'available in store': '店舗で利用可能',
    'membership points': '会員ポイント',
    'purchase history': '購入履歴',
    'out of stock': '在庫切れ',
    'specific budget': '指定予算',
    'sensitive skin': '敏感肌',
    'skin type': '肌タイプ',
    concerns: '肌悩み',
    routine: 'ルーティン',
    alternatives: '代替品',
    recommendations: 'おすすめ',
  },
  ko: {
    'available in store': '매장에서 구매 가능',
    'membership points': '멤버십 포인트',
    'purchase history': '구매 내역',
    'out of stock': '품절',
    'specific budget': '지정 예산',
    'sensitive skin': '민감성 피부',
    'skin type': '피부 타입',
    concerns: '피부 고민',
    routine: '루틴',
    alternatives: '대체 제품',
    recommendations: '추천',
  },
  pt: {
    'available in store': 'disponível na loja',
    'membership points': 'pontos de fidelidade',
    'purchase history': 'histórico de compras',
    'out of stock': 'sem estoque',
    'specific budget': 'orçamento específico',
    'sensitive skin': 'pele sensível',
    'skin type': 'tipo de pele',
    concerns: 'preocupações',
    routine: 'rotina',
    alternatives: 'alternativas',
    recommendations: 'recomendações',
  },
  it: {
    'available in store': 'disponibile in negozio',
    'membership points': 'punti fedeltà',
    'purchase history': 'cronologia acquisti',
    'out of stock': 'esaurito',
    'specific budget': 'budget specifico',
    'sensitive skin': 'pelle sensibile',
    'skin type': 'tipo di pelle',
    concerns: 'esigenze',
    routine: 'routine',
    alternatives: 'alternative',
    recommendations: 'consigli',
  },
  ar: {
    'available in store': 'متوفر في المتجر',
    'membership points': 'نقاط العضوية',
    'purchase history': 'سجل المشتريات',
    'out of stock': 'غير متوفر',
    'specific budget': 'ميزانية محددة',
    'sensitive skin': 'بشرة حساسة',
    'skin type': 'نوع البشرة',
    concerns: 'مشاكل البشرة',
    routine: 'روتين',
    alternatives: 'بدائل',
    recommendations: 'توصيات',
  },
  hi: {
    'available in store': 'स्टोर में उपलब्ध',
    'membership points': 'सदस्यता अंक',
    'purchase history': 'खरीद इतिहास',
    'out of stock': 'स्टॉक में नहीं',
    'specific budget': 'विशिष्ट बजट',
    'sensitive skin': 'संवेदनशील त्वचा',
    'skin type': 'त्वचा का प्रकार',
    concerns: 'त्वचा संबंधी चिंताएं',
    routine: 'रूटीन',
    alternatives: 'विकल्प',
    recommendations: 'सुझाव',
  },
  id: {
    'available in store': 'tersedia di toko',
    'membership points': 'poin keanggotaan',
    'purchase history': 'riwayat pembelian',
    'out of stock': 'habis stok',
    'specific budget': 'anggaran tertentu',
    'sensitive skin': 'kulit sensitif',
    'skin type': 'jenis kulit',
    concerns: 'masalah kulit',
    routine: 'rutinitas',
    alternatives: 'alternatif',
    recommendations: 'rekomendasi',
  },
  ms: {
    'available in store': 'tersedia di kedai',
    'membership points': 'mata keahlian',
    'purchase history': 'sejarah pembelian',
    'out of stock': 'kehabisan stok',
    'specific budget': 'bajet khusus',
    'sensitive skin': 'kulit sensitif',
    'skin type': 'jenis kulit',
    concerns: 'masalah kulit',
    routine: 'rutin',
    alternatives: 'pilihan gantian',
    recommendations: 'cadangan',
  },
  tr: {
    'available in store': 'mağazada mevcut',
    'membership points': 'üyelik puanları',
    'purchase history': 'satın alma geçmişi',
    'out of stock': 'stokta yok',
    'specific budget': 'belirli bütçe',
    'sensitive skin': 'hassas cilt',
    'skin type': 'cilt tipi',
    concerns: 'cilt sorunları',
    routine: 'rutin',
    alternatives: 'alternatifler',
    recommendations: 'öneriler',
  },
}

Object.entries(FAQ_VOCABULARY_EXTENSIONS_BY_LANGUAGE).forEach(([language, vocabulary]) => {
  FAQ_VOCABULARY_BY_LANGUAGE[language] = {
    ...(FAQ_VOCABULARY_BY_LANGUAGE[language] || {}),
    ...vocabulary,
  }
})

const PUBLIC_COPY_PROTECTED_TERMS = [
  'Leang Cosmetics',
  'Leang Cosmetic',
  'Business OS',
  'Facebook',
  'Instagram',
  'Telegram',
]

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLanguageKey(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (lower === 'zh-cn') return 'zh-CN'
  if (lower === 'zh-tw') return 'zh-TW'
  return lower
}

function normalizeText(value) {
  return String(value || '').normalize('NFC').trim()
}

export function normalizePortalTranslations(value) {
  if (!value) return {}
  if (isPlainObject(value)) return value
  if (typeof value !== 'string') return {}
  const raw = value.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : {}
  } catch (_) {
    return {}
  }
}

export function stringifyPortalTranslations(value) {
  const normalized = normalizePortalTranslations(value)
  if (!Object.keys(normalized).length) return '{}'
  return JSON.stringify(normalized, null, 2)
}

function getLanguageBlock(translations, language) {
  const normalized = normalizePortalTranslations(translations)
  const key = normalizeLanguageKey(language)
  if (!key) return {}
  if (isPlainObject(normalized[key])) return normalized[key]
  const lowerMatch = Object.entries(normalized).find(([entryKey]) => normalizeLanguageKey(entryKey) === key)
  if (lowerMatch && isPlainObject(lowerMatch[1])) return lowerMatch[1]
  const base = key.split('-')[0]
  if (base && isPlainObject(normalized[base])) return normalized[base]
  return {}
}

function pickTranslatedText(block, field, fallback) {
  if (!isPlainObject(block)) return fallback
  const candidates = [
    block[field],
    block.fields?.[field],
    block.text?.[field],
  ]
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    if (text) return text
  }
  return fallback
}

function pickDefaultFirstPartyText(language, field, fallback) {
  const [englishDefault, resourceKey] = DEFAULT_CONFIG_COPY_KEYS[field] || []
  if (!englishDefault || normalizeLanguageKey(language) === 'en') return fallback
  if (normalizeText(fallback) !== normalizeText(englishDefault)) return fallback
  return getPortalLanguageText(language, resourceKey) || fallback
}

function getCollectionEntry(collection, id, index) {
  if (!collection) return {}
  if (Array.isArray(collection)) {
    const byIndex = collection[index]
    if (isPlainObject(byIndex)) return byIndex
    return {}
  }
  if (!isPlainObject(collection)) return {}
  const idKey = String(id || '').trim()
  if (idKey && isPlainObject(collection[idKey])) return collection[idKey]
  const indexKey = String(index)
  if (isPlainObject(collection[indexKey])) return collection[indexKey]
  const oneBasedIndexKey = String(index + 1)
  if (isPlainObject(collection[oneBasedIndexKey])) return collection[oneBasedIndexKey]
  return {}
}

function localizeCollectionItems(items, collection, fields) {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : []
  return items.map((item, index) => {
    const entry = getCollectionEntry(collection, item?.id, index)
    if (!Object.keys(entry).length) return item
    const next = { ...item }
    fields.forEach((field) => {
      next[field] = pickTranslatedText(entry, field, next[field])
    })
    return next
  })
}

function getLanguageMap(source, language) {
  const key = normalizeLanguageKey(language)
  if (!key || key === 'en') return null
  if (isPlainObject(source[key])) return source[key]
  const base = key.split('-')[0]
  if (base && isPlainObject(source[base])) return source[base]
  return null
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function protectPublicCopyTerms(value) {
  let text = String(value || '')
  const placeholders = []
  PUBLIC_COPY_PROTECTED_TERMS.forEach((term) => {
    const pattern = new RegExp(escapeRegExp(term), 'g')
    text = text.replace(pattern, (match) => {
      const token = `__BUSINESS_OS_PUBLIC_TERM_${placeholders.length}__`
      placeholders.push([token, match])
      return token
    })
  })
  return { text, placeholders }
}

function restorePublicCopyTerms(value, placeholders) {
  return placeholders.reduce((text, [token, original]) => text.replaceAll(token, original), String(value || ''))
}

export function localizePortalFaqText(value, language) {
  const raw = normalizeText(value)
  const key = normalizeLanguageKey(language)
  if (!raw || !key || key === 'en') return value

  const exactMap = getLanguageMap(DEFAULT_FAQ_TEXT_BY_LANGUAGE, language)
  const exact = exactMap?.[raw]
  if (normalizeText(exact)) return exact

  const vocabulary = getLanguageMap(FAQ_VOCABULARY_BY_LANGUAGE, language)
  if (!vocabulary) return value

  const protectedCopy = protectPublicCopyTerms(value)
  let localized = protectedCopy.text
  const entries = Object.entries(vocabulary)
    .filter(([term, translation]) => normalizeText(term) && normalizeText(translation))
    .sort((left, right) => right[0].length - left[0].length)

  entries.forEach(([term, translation]) => {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
    localized = localized.replace(pattern, translation)
  })

  return restorePublicCopyTerms(localized, protectedCopy.placeholders)
}

function localizeFaqItems(items, collection, language) {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : []
  const localized = localizeCollectionItems(items, collection, ['question', 'answer'])
  return localized.map((item, index) => {
    const entry = getCollectionEntry(collection, item?.id, index)
    const next = { ...item }
    ;['question', 'answer'].forEach((field) => {
      const explicit = normalizeText(pickTranslatedText(entry, field, ''))
      if (!explicit) next[field] = localizePortalFaqText(next[field], language)
    })
    return next
  })
}

export function localizePortalConfig(config, language) {
  const source = isPlainObject(config) ? config : {}
  const translations = normalizePortalTranslations(source.translations)
  const langBlock = getLanguageBlock(translations, language)

  const next = { ...source, translations }
  TRANSLATABLE_CONFIG_FIELDS.forEach((field) => {
    next[field] = pickDefaultFirstPartyText(language, field, pickTranslatedText(langBlock, field, next[field]))
  })

  if (isPlainObject(source.linkLabels) && isPlainObject(langBlock.linkLabels)) {
    next.linkLabels = { ...source.linkLabels }
    Object.keys(next.linkLabels).forEach((key) => {
      next.linkLabels[key] = pickTranslatedText(langBlock.linkLabels, key, next.linkLabels[key])
    })
  }

  next.aboutBlocks = localizeCollectionItems(source.aboutBlocks, langBlock.aboutBlocks, ['title', 'body'])
  next.faqItems = localizeFaqItems(source.faqItems, langBlock.faqItems, language)

  return next
}

function getProductTranslationBlock(product, language, portalTranslations, index) {
  const productTranslations = normalizePortalTranslations(product?.translations || product?.i18n || product?.localized)
  const productBlock = getLanguageBlock(productTranslations, language)
  if (Object.keys(productBlock).length) return productBlock

  const langBlock = getLanguageBlock(portalTranslations, language)
  const products = langBlock.products || langBlock.catalogProducts || langBlock.catalog
  return getCollectionEntry(products, product?.id, index)
}

export function localizePortalProduct(product, language, portalTranslations, index = 0) {
  if (!isPlainObject(product)) return product
  const block = getProductTranslationBlock(product, language, portalTranslations, index)
  if (!Object.keys(block).length) return product
  const next = { ...product }
  PRODUCT_TRANSLATABLE_FIELDS.forEach((field) => {
    next[field] = pickTranslatedText(block, field, next[field])
  })
  return next
}

export function localizePortalProducts(products, language, portalTranslations) {
  if (!Array.isArray(products) || !products.length) return Array.isArray(products) ? products : []
  return products.map((product, index) => localizePortalProduct(product, language, portalTranslations, index))
}
