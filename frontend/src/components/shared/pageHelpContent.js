export const PAGE_HELP_CONTENT = {
  dashboard: {
    en: {
      title: 'Dashboard Guide',
      overview: 'Use Dashboard to monitor sales, discounts, returns, tax, delivery, cost, and profit for the selected period.',
      rules: [
        'Net revenue = gross sales - discounts - refunds + tax + delivery fees.',
        'Store discount and membership discount are tracked separately.',
        'Returns reduce revenue; restocked returns also reverse cost impact.',
        'Tap any stat card to see formula and metric details.',
      ],
      related: [
        'Dashboard reads from POS, Sales, Returns, Inventory, and Loyalty settings.',
        'Top customers/products are period-based and refund-aware.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ផ្ទាំងគ្រប់គ្រង',
      overview: 'ប្រើផ្ទាំងគ្រប់គ្រង ដើម្បីតាមដានការលក់ ការបញ្ចុះតម្លៃ ការត្រឡប់ ពន្ធ ដឹកជញ្ជូន ថ្លៃដើម និងចំណេញ តាមរយៈពេលដែលបានជ្រើស។',
      rules: [
        'ចំណូលសុទ្ធ = ការលក់សរុប - ការបញ្ចុះតម្លៃ - ប្រាក់សងត្រឡប់ + ពន្ធ + ថ្លៃដឹកជញ្ជូន។',
        'បញ្ចុះតម្លៃហាង និងបញ្ចុះតម្លៃសមាជិក ត្រូវបានកត់ត្រាដាច់ដោយឡែក។',
        'ការត្រឡប់នឹងកាត់បន្ថយចំណូល ហើយបើស្តុកត្រឡប់ចូលវិញ នឹងកែថ្លៃដើមឲ្យត្រឹមត្រូវផងដែរ។',
        'ចុចកាតស្ថិតិណាមួយ ដើម្បីមើលរូបមន្ត និងព័ត៌មានលម្អិត។',
      ],
      related: [
        'Dashboard អានទិន្នន័យពី POS, Sales, Returns, Inventory និងការកំណត់ Loyalty។',
        'អតិថិជន/ទំនិញកំពូល គិតតាមរយៈពេល និងគិតការត្រឡប់ជាមួយ។',
      ],
    },
  },
  catalog: {
    en: {
      title: 'Customer Portal Management Guide',
      overview: 'This page is for staff to manage the public customer portal: content, visibility, business profile, and portal behavior.',
      rules: [
        'Customers can view only. Editing is managed here by authorized staff.',
        'Use this page to control what customers see: products, prices, stock status, membership lookup, and engagement submissions.',
        'Keep admin URL and public customer URL separate for security.',
      ],
      related: [
        'Portal data syncs from Products, Inventory, Sales, Returns, Contacts, and Loyalty settings.',
        'Use preview before publishing to public URL.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍គ្រប់គ្រង Customer Portal',
      overview: 'ទំព័រនេះសម្រាប់បុគ្គលិកគ្រប់គ្រងផតថលអតិថិជនសាធារណៈ៖ មាតិកា ការបង្ហាញព័ត៌មាន ប្រវត្តិអាជីវកម្ម និងរបៀបដំណើរការ។',
      rules: [
        'អតិថិជនអាចមើលបានតែប៉ុណ្ណោះ។ ការកែសម្រួលធ្វើតាមទំព័រនេះដោយបុគ្គលិកដែលមានសិទ្ធិ។',
        'កំណត់អ្វីដែលអតិថិជនអាចមើលបាន ដូចជា ទំនិញ តម្លៃ ស្ថានភាពស្តុក Membership Lookup និងការដាក់ស្នើរូបភាព។',
        'សូមបំបែក URL ខាងក្នុង (Admin) និង URL សាធារណៈ (Customer) ដើម្បីសុវត្ថិភាព។',
      ],
      related: [
        'ទិន្នន័យ Portal សមកាលកម្មពី Products, Inventory, Sales, Returns, Contacts និង Loyalty Settings។',
        'សូមពិនិត្យ Preview មុនចេញផ្សាយទៅ URL សាធារណៈ។',
      ],
    },
  },
  catalog_public: {
    en: {
      title: 'Customer Portal Help',
      overview: 'Welcome. This website is a read-only customer page for checking products, availability, and membership information.',
      rules: [
        'You can search and filter products by category, brand, and stock status.',
        'You can check membership history and points balance by entering your membership number.',
        'You cannot place orders or edit data on this page. Please contact store staff for purchases, returns, or point redemption.',
      ],
      related: [
        'Product and membership data update from the store system.',
        'If information looks incorrect, contact the store directly and provide your membership number.',
      ],
    },
    km: {
      title: 'ជំនួយផតថលអតិថិជន',
      overview: 'សូមស្វាគមន៍។ គេហទំព័រនេះជាទំព័រអតិថិជនសម្រាប់មើលព័ត៌មានតែប៉ុណ្ណោះ ដើម្បីពិនិត្យទំនិញ ស្ថានភាពស្តុក និងព័ត៌មានសមាជិកភាព។',
      rules: [
        'អ្នកអាចស្វែងរក និងត្រងទំនិញតាមប្រភេទ ម៉ាក និងស្ថានភាពស្តុក។',
        'អ្នកអាចពិនិត្យប្រវត្តិ និងពិន្ទុសមាជិក ដោយបញ្ចូលលេខសមាជិក។',
        'អ្នកមិនអាចបញ្ជាទិញ ឬកែទិន្នន័យនៅលើទំព័រនេះទេ។ សូមទាក់ទងបុគ្គលិកហាងសម្រាប់ការទិញ ការត្រឡប់ ឬការប្រើពិន្ទុ។',
      ],
      related: [
        'ទិន្នន័យទំនិញ និងសមាជិកភាព ត្រូវបានធ្វើបច្ចុប្បន្នភាពពីប្រព័ន្ធហាង។',
        'បើមានព័ត៌មានមិនត្រឹមត្រូវ សូមទាក់ទងហាង និងផ្ដល់លេខសមាជិករបស់អ្នក។',
      ],
    },
  },
  loyalty_points: {
    en: {
      title: 'Loyalty Points Guide',
      overview: 'Manage point earning, redemption rules, conversion value, and customer-facing point messaging here.',
      rules: [
        'Only completed sales earn points. Returns and refunds deduct points based on configured rules.',
        'Membership discount in POS is separate from store discount.',
        'Redemption units are whole-number based in checkout logic.',
      ],
      related: [
        'Loyalty rules affect POS, Sales totals, Returns, Dashboard metrics, Inventory analytics, and Customer Portal display.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ពិន្ទុសមាជិក',
      overview: 'គ្រប់គ្រងច្បាប់រកពិន្ទុ ការប្រើពិន្ទុ អត្រាបម្លែង និងសារបង្ហាញទៅអតិថិជន នៅទីនេះ។',
      rules: [
        'តែការលក់ដែលបានបញ្ចប់ប៉ុណ្ណោះ ទើបទទួលពិន្ទុ។ ការត្រឡប់/សងប្រាក់នឹងកាត់ពិន្ទុតាមច្បាប់ដែលកំណត់។',
        'បញ្ចុះតម្លៃសមាជិកក្នុង POS ដាច់ដោយឡែកពីបញ្ចុះតម្លៃហាង។',
        'ការប្រើពិន្ទុនៅពេល Checkout គិតជាចំនួនគត់ (whole number)។',
      ],
      related: [
        'ច្បាប់ពិន្ទុមានផលលើ POS, Sales, Returns, Dashboard, Inventory និង Customer Portal។',
      ],
    },
  },
  pos: {
    en: {
      title: 'POS Guide',
      overview: 'POS creates sales, applies discounts, handles payment status, and records checkout details.',
      rules: [
        'Store discount and membership discount are separate lines.',
        'Sale status controls accounting impact (for example, awaiting payment does not count as completed revenue yet).',
        'Stock validation happens by branch during checkout.',
      ],
      related: [
        'POS writes to Sales, Inventory movements, Dashboard stats, Loyalty calculations, and Receipts.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ POS',
      overview: 'POS សម្រាប់បង្កើតការលក់ អនុវត្តបញ្ចុះតម្លៃ គ្រប់គ្រងស្ថានភាពបង់ប្រាក់ និងកត់ត្រាព័ត៌មាន Checkout។',
      rules: [
        'បញ្ចុះតម្លៃហាង និងបញ្ចុះតម្លៃសមាជិក បង្ហាញជាបន្ទាត់ដាច់ដោយឡែក។',
        'ស្ថានភាពការលក់មានឥទ្ធិពលលើគណនេយ្យ (ឧ. Awaiting Payment មិនទាន់រាប់ជាចំណូលបានបញ្ចប់)។',
        'ពិនិត្យស្តុកតាមសាខា ពេល Checkout។',
      ],
      related: [
        'POS សរសេរទិន្នន័យទៅ Sales, Inventory Movements, Dashboard, Loyalty និង Receipt។',
      ],
    },
  },
  products: {
    en: {
      title: 'Products Guide',
      overview: 'Products is the master source for item names, pricing, cost, categories, units, and thresholds.',
      rules: [
        'Selling price is used by POS and Customer Portal.',
        'Cost is internal and used for COGS and profit analytics.',
        'Keep product metadata complete for reliable filtering and reports.',
      ],
      related: [
        'Products feed Inventory, Branch stock views, POS cart logic, Dashboard, and Catalog.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ផលិតផល',
      overview: 'Products ជាប្រភពទិន្នន័យមេ សម្រាប់ឈ្មោះទំនិញ តម្លៃ ថ្លៃដើម ប្រភេទ ឯកតា និងកម្រិតស្តុក។',
      rules: [
        'តម្លៃលក់ ត្រូវបានប្រើនៅ POS និង Customer Portal។',
        'ថ្លៃដើមគឺសម្រាប់ខាងក្នុង និងប្រើក្នុង COGS និងវិភាគចំណេញ។',
        'បំពេញព័ត៌មានទំនិញឲ្យគ្រប់ ដើម្បីឲ្យត្រងទិន្នន័យ និងរបាយការណ៍មានភាពត្រឹមត្រូវ។',
      ],
      related: [
        'Products ផ្គត់ផ្គង់ទិន្នន័យទៅ Inventory, Branches, POS, Dashboard និង Catalog។',
      ],
    },
  },
  inventory: {
    en: {
      title: 'Inventory Guide',
      overview: 'Inventory tracks stock quantity, stock value, movement history, and inventory-linked statistics.',
      rules: [
        'Transfers move stock between branches without changing total company quantity.',
        'Returns affect stock only when restock is enabled for the return action.',
        'Net sold, revenue, COGS, and profit reflect returns and discount impacts.',
      ],
      related: [
        'Inventory is updated by Products, POS, Sales status changes, Returns, and Branch transfers.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ស្តុក',
      overview: 'Inventory តាមដានបរិមាណស្តុក តម្លៃស្តុក ប្រវត្តិចលនា និងស្ថិតិដែលពាក់ព័ន្ធនឹងស្តុក។',
      rules: [
        'ការផ្ទេរស្តុកផ្លាស់ទីរវាងសាខា ដោយមិនប្តូរបរិមាណសរុបរបស់ក្រុមហ៊ុន។',
        'ការត្រឡប់នឹងប៉ះពាល់ស្តុក តែពេលកំណត់ឲ្យ Restock ប៉ុណ្ណោះ។',
        'Net Sold, Revenue, COGS និង Profit គិតបញ្ចូលផលប៉ះពាល់ពីការត្រឡប់ និងការបញ្ចុះតម្លៃ។',
      ],
      related: [
        'Inventory ត្រូវបានធ្វើបច្ចុប្បន្នភាពដោយ Products, POS, Sales Status, Returns និង Transfers។',
      ],
    },
  },
  branches: {
    en: {
      title: 'Branches Guide',
      overview: 'Branches manages store locations and branch-level stock ownership.',
      rules: [
        'Each branch has independent available stock for POS and operational workflows.',
        'Cannot delete a branch while it still owns stock.',
        'Use transfer workflow for controlled stock movement between branches.',
      ],
      related: [
        'Branch stock impacts POS availability, inventory summaries, and customer portal stock status.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍សាខា',
      overview: 'Branches សម្រាប់គ្រប់គ្រងទីតាំងសាខា និងភាពជាម្ចាស់ស្តុកតាមសាខា។',
      rules: [
        'សាខានីមួយៗមានស្តុកឯករាជ្យ សម្រាប់ POS និងប្រតិបត្តិការ។',
        'មិនអាចលុបសាខា ប្រសិនបើនៅមានស្តុកនៅសាខានោះ។',
        'ប្រើ Transfer Workflow ដើម្បីផ្ទេរស្តុករវាងសាខាដោយមានការតាមដាន។',
      ],
      related: [
        'ស្តុកសាខាមានឥទ្ធិពលលើ POS, Inventory និងស្ថានភាពស្តុកក្នុង Customer Portal។',
      ],
    },
  },
  sales: {
    en: {
      title: 'Sales Guide',
      overview: 'Sales is the system of record for receipts, statuses, totals, and customer membership attachment.',
      rules: [
        'Status updates can change accounting and loyalty outcomes.',
        'Partial returns update totals without deleting the original sale.',
        'Anonymous sales can be linked to a membership later from sale detail.',
      ],
      related: [
        'Sales powers Receipt detail, Dashboard metrics, Return workflows, and customer membership history.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ការលក់',
      overview: 'Sales ជាកំណត់ត្រាផ្លូវការ សម្រាប់វិក្កយបត្រ ស្ថានភាព ចំនួនសរុប និងការភ្ជាប់សមាជិកទៅការលក់។',
      rules: [
        'ការផ្លាស់ប្តូរស្ថានភាពអាចប៉ះពាល់ដល់គណនេយ្យ និងលទ្ធផលពិន្ទុសមាជិក។',
        'Partial Return កែសម្រួលចំនួនសរុប ដោយមិនលុបការលក់ដើម។',
        'ការលក់អនាមិកអាចភ្ជាប់សមាជិកនៅពេលក្រោយពី Sale Detail។',
      ],
      related: [
        'Sales ត្រូវបានប្រើដោយ Receipt, Dashboard, Returns និងប្រវត្តិសមាជិកក្នុង Customer Portal។',
      ],
    },
  },
  returns: {
    en: {
      title: 'Returns Guide',
      overview: 'Returns handles refunds, restocking behavior, supplier returns, and accounting corrections.',
      rules: [
        'Refunded amounts reduce net revenue.',
        'Restocked returns add stock back; non-restocked returns do not.',
        'Supplier return handling should capture compensation and loss for accounting visibility.',
      ],
      related: [
        'Returns update Sales summaries, Inventory quantities, Dashboard metrics, and membership point outcomes.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ការត្រឡប់',
      overview: 'Returns គ្រប់គ្រងការសងប្រាក់ ការបញ្ចូលស្តុកវិញ Return ទៅអ្នកផ្គត់ផ្គង់ និងការកែតម្រូវគណនេយ្យ។',
      rules: [
        'ចំនួនប្រាក់ដែលសងវិញ នឹងកាត់បន្ថយចំណូលសុទ្ធ។',
        'Return ដែល Restock នឹងបញ្ចូលស្តុកវិញ; បើមិន Restock នឹងមិនប៉ះពាល់ស្តុក។',
        'Return ទៅ Supplier គួរកត់ត្រាសំណង និងខាតបង់ ដើម្បីឲ្យគណនេយ្យមើលឃើញច្បាស់។',
      ],
      related: [
        'Returns បច្ចុប្បន្នភាព Sales, Inventory, Dashboard និងលទ្ធផលពិន្ទុសមាជិក។',
      ],
    },
  },
  contacts: {
    en: {
      title: 'Contacts Guide',
      overview: 'Contacts stores customers, suppliers, delivery contacts, and membership identifiers.',
      rules: [
        'Membership number should be unique and stable for accurate lookup.',
        'Use conflict handling options during import to avoid accidental overwrites.',
      ],
      related: [
        'Contacts are reused in POS checkout, Sales records, Delivery flows, and Customer Portal membership checks.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ទំនាក់ទំនង',
      overview: 'Contacts រក្សាទុកអតិថិជន អ្នកផ្គត់ផ្គង់ ទំនាក់ទំនងដឹកជញ្ជូន និងលេខសមាជិក។',
      rules: [
        'លេខសមាជិកគួរតែឯកត្ត និងថេរ ដើម្បីឲ្យ Lookup ត្រឹមត្រូវ។',
        'ពេល Import សូមប្រើ Conflict Handling ឲ្យសមរម្យ ដើម្បីជៀសវាងការសរសេរជាន់លើទិន្នន័យដោយចៃដន្យ។',
      ],
      related: [
        'Contacts ត្រូវបានប្រើឡើងវិញក្នុង POS, Sales, Delivery និង Customer Portal Membership Lookup។',
      ],
    },
  },
  users: {
    en: {
      title: 'Users Guide',
      overview: 'Manage users, permissions, profile security, and access boundaries here.',
      rules: [
        'Grant least privilege needed for each role.',
        'Customer portal management permission should be limited to trusted staff.',
        'Security options (password updates, verification methods, OTP) should be reviewed regularly.',
      ],
      related: [
        'Permission changes apply across all pages and workflows after policy refresh or next login.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍អ្នកប្រើ',
      overview: 'គ្រប់គ្រងអ្នកប្រើ សិទ្ធិ សុវត្ថិភាពប្រវត្តិរូប និងព្រំដែនការចូលប្រើ នៅទីនេះ។',
      rules: [
        'ផ្ដល់សិទ្ធិត្រឹមត្រូវតាមតម្រូវការពិតប្រាកដរបស់តួនាទីនីមួយៗ។',
        'សិទ្ធិគ្រប់គ្រង Customer Portal គួរផ្ដល់តែបុគ្គលិកដែលទុកចិត្តបាន។',
        'គួរត្រួតពិនិត្យជាញឹកញាប់លើជម្រើសសុវត្ថិភាព (ពាក្យសម្ងាត់ ការផ្ទៀងផ្ទាត់ និង OTP)។',
      ],
      related: [
        'ការកែសិទ្ធិមានឥទ្ធិពលលើទំព័រ និង Workflow ទាំងអស់ បន្ទាប់ពី Refresh Policy ឬ Login ម្តងទៀត។',
      ],
    },
  },
  audit_log: {
    en: {
      title: 'Audit Log Guide',
      overview: 'Audit Log shows who changed what, when, and from which device.',
      rules: [
        'Use filters and search for quick investigation.',
        'Review sensitive operations regularly: role changes, imports, resets, transfers, and sale status changes.',
      ],
      related: [
        'Audit entries are generated by activity across Products, Sales, Returns, Contacts, Users, and Settings.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ Audit Log',
      overview: 'Audit Log បង្ហាញថា នរណាបានកែអ្វី ពេលណា និងពីឧបករណ៍ណា។',
      rules: [
        'ប្រើ Filter និង Search ដើម្បីស្វែងរកកំណត់ត្រាបានរហ័ស។',
        'គួរត្រួតពិនិត្យសកម្មភាពសំខាន់ៗជាប្រចាំ៖ កែសិទ្ធិ Import/Reset Transfer និងការប្តូរស្ថានភាពលក់។',
      ],
      related: [
        'Audit Entries ត្រូវបានបង្កើតពីសកម្មភាពលើ Products, Sales, Returns, Contacts, Users និង Settings។',
      ],
    },
  },
  receipt_settings: {
    en: {
      title: 'Receipt Settings Guide',
      overview: 'Configure printed receipt content, field visibility, and layout behavior.',
      rules: [
        'Show or hide delivery details, tax, discount rows, and totals based on business policy.',
        'Membership discount and store discount can be shown as separate lines for transparency.',
      ],
      related: [
        'Receipt output depends on POS checkout data and final sale records.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ការកំណត់វិក្កយបត្រ',
      overview: 'កំណត់មាតិកាវិក្កយបត្របោះពុម្ព ការបង្ហាញវាល និងរចនាសម្ព័ន្ធប្លង់។',
      rules: [
        'បង្ហាញ/លាក់ព័ត៌មានដឹកជញ្ជូន ពន្ធ បញ្ចុះតម្លៃ និងចំនួនសរុប តាមគោលការណ៍អាជីវកម្ម។',
        'អាចបង្ហាញបញ្ចុះតម្លៃសមាជិក និងបញ្ចុះតម្លៃហាងដាច់ដោយឡែក ដើម្បីឲ្យច្បាស់លាស់។',
      ],
      related: [
        'លទ្ធផលវិក្កយបត្រពឹងផ្អែកលើទិន្នន័យ Checkout ពី POS និងកំណត់ត្រាលក់ចុងក្រោយ។',
      ],
    },
  },
  backup: {
    en: {
      title: 'Backup Guide',
      overview: 'Backup handles export/import of operational data, settings, and related assets.',
      rules: [
        'Always verify destination/source folder before import or restore.',
        'Import can replace current records; keep a fresh backup before major changes.',
      ],
      related: [
        'Backup includes settings affecting Customer Portal, users/roles, and many connected workflows.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ Backup',
      overview: 'Backup សម្រាប់នាំចេញ/នាំចូលទិន្នន័យប្រតិបត្តិការ ការកំណត់ និងឯកសារពាក់ព័ន្ធ។',
      rules: [
        'មុន Import ឬ Restore សូមពិនិត្យថតគោលដៅ/ប្រភពឲ្យត្រឹមត្រូវជាមុន។',
        'Import អាចជំនួសកំណត់ត្រាបច្ចុប្បន្ន ដូច្នេះគួរធ្វើ Backup ថ្មីមុនធ្វើការផ្លាស់ប្តូរធំៗ។',
      ],
      related: [
        'Backup គ្របដណ្តប់ការកំណត់ដែលប៉ះពាល់ដល់ Customer Portal, Users/Roles និង Workflow ជាច្រើន។',
      ],
    },
  },
  settings: {
    en: {
      title: 'Settings Guide',
      overview: 'Settings controls business profile, UI preferences, localization, currency, and operational defaults.',
      rules: [
        'Theme, language, and design settings affect shared components across desktop and mobile.',
        'Currency and exchange settings influence pricing display and financial calculations.',
      ],
      related: [
        'Changes here impact POS, Dashboard, Inventory, Receipts, and Customer-facing pages.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ Settings',
      overview: 'Settings គ្រប់គ្រងព័ត៌មានអាជីវកម្ម រចនាប័ទ្ម UI ភាសា រូបិយប័ណ្ណ និងកំណត់ដើមប្រតិបត្តិការ។',
      rules: [
        'Theme, Language និង Design ប៉ះពាល់ទៅកាន់សមាសភាគរួមទាំង Desktop និង Mobile។',
        'Currency និង Exchange Rate ប៉ះពាល់ដល់ការបង្ហាញតម្លៃ និងការគណនាហិរញ្ញវត្ថុ។',
      ],
      related: [
        'ការផ្លាស់ប្តូរនៅទីនេះមានឥទ្ធិពលលើ POS, Dashboard, Inventory, Receipt និងទំព័រអតិថិជន។',
      ],
    },
  },
  server: {
    en: {
      title: 'Server & URL Guide',
      overview: 'Manage sync connectivity, server URL, token settings, and public URL references from this page.',
      rules: [
        'Treat internal admin URL and public customer URL as separate entry points.',
        'Keep secure tokens private and rotate them when needed.',
      ],
      related: [
        'Server connectivity affects sync speed, real-time updates, and portal accessibility.',
      ],
    },
    km: {
      title: 'មគ្គុទេសក៍ Server និង URL',
      overview: 'គ្រប់គ្រងការតភ្ជាប់ Sync, Server URL, Token និង URL សាធារណៈ នៅទំព័រនេះ។',
      rules: [
        'សូមចាត់ទុក URL ខាងក្នុង (Admin) និង URL សាធារណៈ (Customer) ជាច្រកចូលដាច់ដោយឡែក។',
        'រក្សា Token សុវត្ថិភាពឲ្យជាសម្ងាត់ និងប្តូរវាតាមតម្រូវការ។',
      ],
      related: [
        'ការតភ្ជាប់ Server ប៉ះពាល់ដល់ល្បឿន Sync, ការធ្វើបច្ចុប្បន្នភាពពេលជាក់ស្តែង និងការចូលប្រើ Portal។',
      ],
    },
  },
}

export function getPageHelpContent(pageId, language = 'en') {
  const key = pageId === 'catalog-public' ? 'catalog_public' : pageId
  const page = PAGE_HELP_CONTENT[key] || PAGE_HELP_CONTENT.dashboard
  return page[language === 'km' ? 'km' : 'en']
}
