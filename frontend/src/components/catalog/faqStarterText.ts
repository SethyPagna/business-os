// The storefront FAQ a shop starts with, before the owner edits a word of
// it. It lives in its own module for two reasons.
//
// It is the app speaking, not the merchant, so every sentence here is a
// claim WE make on their behalf and have to be able to stand behind. Item
// 24 used to promise "100% authentic" products as an absolute guarantee
// nobody in this codebase can substantiate; it now describes the sourcing
// the shop actually does and offers to check a specific item, which is a
// statement that survives being asked to prove it (N45).
//
// And it was previously buried inside CatalogPage.tsx, so the test that
// guards it (tests/portalFaqVocabulary.test.ts) kept its own hand-copied
// duplicate of every string -- which is how the wording and its guard were
// free to disagree. A React-free module can be imported by the test, so
// there is only one copy of this text in the repository.
export const FAQ_STARTER_TEXT = [
  ['1', 'How do I choose products for my skin type?', 'Tell us your skin type, concerns, and what kind of routine you want. We can recommend suitable skincare, cosmetics, hair, or body products from our available stock.'],
  ['2', 'Are the products shown here available in store?', 'The portal reads from our current Business OS catalog. Stock can still change during busy periods, so please contact the store if you need a final confirmation before visiting.'],
  ['3', 'How do I check my membership points?', 'Sign in and open your account. Your membership ID and current account details are shown there securely.'],
  ['4', 'How does Share & Reward work?', 'Share our store on social media, upload your screenshot in the portal, and our staff will review it. Approved submissions can receive reward points in your membership account.'],
  ['5', 'How can I contact Leang Beauty for more accurate advice?', 'Use the social links on this page or call the store directly. Our team can help with product matching, stock checks, and more specific skincare or makeup questions.'],
  ['6', 'Do you have products for sensitive skin?', 'Yes. Ask our team or use the AI assistant with your skin type and concerns so we can narrow options that are gentler and easier to compare from current stock.'],
  ['7', 'Can I ask whether a product is original or from a specific brand line?', 'Yes. Contact the store directly if you want brand confirmation, latest packaging details, or a more exact stock check before buying.'],
  ['8', 'Do you sell skincare, makeup, hair care, and body care together?', 'Yes. Leang Beauty carries multiple beauty categories, so you can search the catalog or ask for recommendations across skincare, cosmetics, perfume, hair, and body products.'],
  ['9', 'Can the store help me build a full routine?', 'Yes. Share your budget, skin type, concerns, and whether you need morning, night, or event-based products. We can help match a more complete routine from available products.'],
  ['10', 'What should I do if an item is out of stock?', 'If an item is unavailable, message the store through Facebook, Instagram, Telegram, or phone so the team can suggest alternatives or confirm when stock changes.'],
  ['11', 'Can I ask for products within a specific budget?', 'Yes. Tell us your budget and what category you want, and we can narrow options from the current catalog.'],
  ['12', 'Do you have gift-friendly items or bundles?', 'Yes. Ask the store team or use the assistant to explore perfumes, makeup, skincare, and beauty gifts that fit the occasion.'],
  ['13', 'Can I ask for alternatives if my preferred brand is unavailable?', 'Yes. We can suggest similar products from other brands in stock based on category, concern, and price range.'],
  ['14', 'Can I check whether a product is suitable for oily, dry, or combination skin?', 'Yes. Use the assistant or contact the store with your skin type and concern so recommendations stay closer to your needs.'],
  ['15', 'Do you also carry hair, body, and fragrance products?', 'Yes. The store carries more than just skincare and makeup, so you can also browse hair, body, perfume, and related beauty items when available.'],
  ['21', 'Do you offer delivery, or is it pickup only?', 'We support delivery in select areas along with in-store pickup. Message the store on Facebook, Instagram, or Telegram with your location so we can confirm delivery options and timing.'],
  ['22', 'What payment methods do you accept?', 'We accept cash and common mobile payment options in store. For delivery or online orders, contact us directly to confirm which payment method works best for your order.'],
  ['23', 'What are your store hours?', 'Store hours can vary by branch and public holidays. Please check the branch details on this page or contact us directly for the most current opening hours.'],
  ['24', 'Are the products sold here authentic?', 'We buy through official distributors and authorised suppliers and keep the sourcing records for what we sell, so we can check whether a specific item is authentic. If you have a concern about an item, contact the store directly and we will go through its sourcing with you.'],
  ['25', 'Where can I see current promotions and discounts?', 'Check the Promotions section on this page for current offers. New discounts and bundles are added there as they become available, so it is worth checking back regularly.'],
]

export const AI_FAQ_STARTER_TEXT = [
  ['16', 'What details help the AI recommend better products?', 'Add your skin type, concerns, brand preferences, and what you want the product to do. The assistant uses that together with our current catalog to narrow better matches.'],
  ['17', 'Does the AI only recommend products available at Leang Beauty?', 'Yes. The assistant is designed to prioritize products from our current Business OS catalog, then explain why those items fit your question.'],
  ['18', 'Should I trust the AI as medical or skin-treatment advice?', 'No. AI answers are for reference only. For sensitive skin issues, allergies, pregnancy-safe guidance, or stronger treatment advice, please contact our team directly first.'],
  ['19', 'Why does the assistant sometimes suggest several options instead of one product?', 'The assistant compares your question against the live store catalog, so it may show a short list when several products fit your needs or when stock can change by branch.'],
  ['20', 'Can the assistant explain why a product was recommended?', 'Yes. Open a suggested product to see the reason, use case, and any extra online reference notes the provider returned for that answer.'],
]
