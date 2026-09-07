// The storefront FAQ a shop starts with, before the owner edits a word of
// it. It lives in its own module for two reasons.
//
// It is the app speaking, not the merchant, so every sentence here is a
// claim WE make on their behalf and have to be able to stand behind. Item
// 24 used to promise "100% authentic" products and then described sourcing
// records nobody verified. It now asks the store for evidence about the
// specific item without making a business claim on the merchant's behalf.
//
// And it was previously buried inside CatalogPage.tsx, so the test that
// guards it (tests/portalFaqVocabulary.test.ts) kept its own hand-copied
// duplicate of every string -- which is how the wording and its guard were
// free to disagree. A React-free module can be imported by the test, so
// there is only one copy of this text in the repository.
export const FAQ_STARTER_TEXT = [
  ['1', 'How do I compare products for my skin type?', 'Use the catalogue description and manufacturer label to compare products. For allergies, reactions, skin conditions, medicines, or pregnancy, ask a qualified health professional.'],
  ['2', 'Are the products shown here available in store?', 'The portal reads from our current Business OS catalog. Stock can still change during busy periods, so please contact the store if you need a final confirmation before visiting.'],
  ['3', 'How do I check my membership points?', 'Sign in and open your account. Your membership ID and current account details are shown there securely.'],
  ['4', 'How does Share & Reward work?', 'Share our store on social media, upload your screenshot in the portal, and our staff will review it. Approved submissions can receive reward points in your membership account.'],
  ['5', 'How can I contact the store?', 'Use the verified contact links on this page to ask about a product or request a current stock check.'],
  ['6', 'How should I choose a product for sensitive skin?', 'Read the product label and ingredient list and ask a qualified health professional about allergies or reactions. The catalogue and AI assistant do not provide medical advice.'],
  ['7', 'Can I ask about a product or brand line?', 'Contact the store about the specific item and ask what packaging, batch, supplier, or sourcing information can be verified before buying.'],
  ['8', 'What types of products are available?', 'Use the category and brand filters to see what is currently listed. Contact the store if a product or category is not shown.'],
  ['9', 'Can I ask about a routine?', 'You can contact the store with your budget and preferences. For skin conditions, allergies, reactions, medicines, or pregnancy, ask a qualified health professional.'],
  ['10', 'What should I do if an item is out of stock?', 'If an item is unavailable, message the store through Facebook, Instagram, Telegram, or phone so the team can suggest alternatives or confirm when stock changes.'],
  ['11', 'Can I look for products within a specific budget?', 'Use the prices shown in the current catalogue and contact the store to confirm a final price before purchase.'],
  ['12', 'Are gifts or bundles available?', 'Check the current catalogue and promotions, then contact the store to confirm what is available.'],
  ['13', 'Can I compare alternatives if a brand is unavailable?', 'Compare current products by category, description, price and stock status. The store can confirm current availability.'],
  ['14', 'How do I check whether a product suits my skin type?', 'Read the manufacturer label and ingredient list. The catalogue cannot determine medical suitability; ask a qualified health professional about allergies, reactions, or skin conditions.'],
  ['15', 'Where can I see the product categories?', 'Use the current category filters. They reflect the products listed in the catalogue.'],
  ['21', 'Do you offer delivery, or is it pickup only?', 'Contact the store with your location to confirm available delivery or collection options, timing, and fees before ordering.'],
  ['22', 'What payment methods do you accept?', 'Payment is not collected on this site. Contact the store to confirm the available payment method before ordering.'],
  ['23', 'What are your store hours?', 'Store hours can vary by branch and public holidays. Please check the branch details on this page or contact us directly for the most current opening hours.'],
  ['24', 'How can I ask about a product\'s source or authenticity?', 'Contact the store about the specific item and ask what sourcing, batch, packaging, or supplier information can be verified. This catalogue does not make a blanket authenticity guarantee.'],
  ['25', 'Where can I see current promotions and discounts?', 'Check the Promotions section for offers currently published by the store, then confirm the final price and terms before purchase.'],
]

export const AI_FAQ_STARTER_TEXT = [
  ['16', 'What details help the AI recommend better products?', 'Add your skin type, concerns, brand preferences, and what you want the product to do. The assistant uses that together with our current catalog to narrow better matches.'],
  ['17', 'Which products can the AI recommend?', 'The assistant receives a limited set of products from the current public catalogue. Stock can change, so confirm availability with the store.'],
  ['18', 'Should I trust the AI as medical or skin-treatment advice?', 'No. AI answers are for general product comparison only. Ask a qualified health professional about sensitive skin, allergies, reactions, treatment, medicines, or pregnancy.'],
  ['19', 'Why does the assistant sometimes suggest several options instead of one product?', 'The assistant compares your question against the live store catalog, so it may show a short list when several products fit your needs or when stock can change by branch.'],
  ['20', 'Can the assistant explain why a product was suggested?', 'A suggestion can include a catalogue-based reason, use instructions and cautions. The assistant does not browse for reviews or prove product claims.'],
]
