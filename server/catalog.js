// Demo catalog. All money is integer cents; weighed items are priced per pound.
// Three kinds of items exist on purpose, because each one moves the hold differently:
//   fixed price, not substitutable  -> no buffer
//   fixed price, substitutable      -> substitution buffer (and optional "up to $3 more" opt-in)
//   priced by weight                -> weight buffer
// Substitutes are what the shopper can scan in store. Their prices live here, on the server,
// so the browser can only say which substitute was picked, never what it costs.
export const AISLES = ['Produce', 'Dairy & alternatives', 'Bakery', 'Pantry'];

export const CATALOG = [
  // Produce
  { id: 'onions', name: 'Yellow onions', unit: 'lb', price: 150, weighed: true, substitutable: false, category: 'Produce' },
  { id: 'bananas', name: 'Bananas', unit: 'lb', price: 70, weighed: true, substitutable: false, category: 'Produce' },
  { id: 'apples', name: 'Gala apples', unit: 'lb', price: 196, weighed: true, substitutable: false, category: 'Produce' },
  {
    id: 'strawberries', name: 'Organic strawberries, 1 lb', unit: 'each', price: 499, weighed: false, substitutable: true, category: 'Produce',
    substitutes: [
      { id: 'strawberries_blueberries', name: 'Blueberries, 1 pint', price: 449 },
      { id: 'strawberries_raspberries', name: 'Organic raspberries, 6 oz', price: 599 },
    ],
  },
  {
    id: 'spinach', name: 'Baby spinach, 5 oz', unit: 'each', price: 399, weighed: false, substitutable: true, category: 'Produce',
    substitutes: [
      { id: 'spinach_springmix', name: 'Organic spring mix, 5 oz', price: 429 },
      { id: 'spinach_kale', name: 'Baby kale, 5 oz', price: 549 },
    ],
  },
  {
    id: 'avocados', name: 'Hass avocado', unit: 'each', price: 129, weighed: false, substitutable: true, category: 'Produce',
    substitutes: [
      { id: 'avocados_small', name: 'Hass avocado, small', price: 99 },
      { id: 'avocados_large', name: 'Hass avocado, large', price: 179 },
    ],
  },
  // Dairy & alternatives
  {
    id: 'oatmilk', name: 'Oat milk, 64 oz', unit: 'each', price: 549, weighed: false, substitutable: true, category: 'Dairy & alternatives',
    substitutes: [
      { id: 'oatmilk_store', name: 'Store-brand oat milk, 64 oz', price: 479 },
      { id: 'oatmilk_barista', name: 'Barista oat milk, 64 oz', price: 708 },
      { id: 'oatmilk_smallbatch', name: 'Small-batch oat milk, 64 oz', price: 2500 },
    ],
  },
  {
    id: 'yogurt', name: 'Greek yogurt, 32 oz', unit: 'each', price: 629, weighed: false, substitutable: true, category: 'Dairy & alternatives',
    substitutes: [
      { id: 'yogurt_store', name: 'Store-brand Greek yogurt, 32 oz', price: 549 },
      { id: 'yogurt_organic', name: 'Organic Greek yogurt, 32 oz', price: 799 },
    ],
  },
  {
    id: 'eggs', name: 'Free-range eggs, dozen', unit: 'each', price: 724, weighed: false, substitutable: true, category: 'Dairy & alternatives',
    substitutes: [
      { id: 'eggs_cagefree', name: 'Cage-free eggs, dozen', price: 649 },
      { id: 'eggs_pasture', name: 'Pasture-raised eggs, dozen', price: 899 },
    ],
  },
  {
    id: 'cheddar', name: 'Sharp cheddar, 8 oz', unit: 'each', price: 449, weighed: false, substitutable: true, category: 'Dairy & alternatives',
    substitutes: [
      { id: 'cheddar_mild', name: 'Mild cheddar, 8 oz', price: 429 },
      { id: 'cheddar_aged', name: 'Aged white cheddar, 8 oz', price: 649 },
    ],
  },
  {
    id: 'butter', name: 'Salted butter, 1 lb', unit: 'each', price: 579, weighed: false, substitutable: true, category: 'Dairy & alternatives',
    substitutes: [
      { id: 'butter_store', name: 'Store-brand butter, 1 lb', price: 499 },
      { id: 'butter_european', name: 'European-style butter, 1 lb', price: 799 },
    ],
  },
  // Bakery
  {
    id: 'sourdough', name: 'Sourdough loaf', unit: 'each', price: 599, weighed: false, substitutable: true, category: 'Bakery',
    substitutes: [
      { id: 'sourdough_country', name: 'Country white loaf', price: 549 },
      { id: 'sourdough_seeded', name: 'Seeded sourdough loaf', price: 699 },
    ],
  },
  {
    id: 'bagels', name: 'Plain bagels, 6 ct', unit: 'each', price: 499, weighed: false, substitutable: true, category: 'Bakery',
    substitutes: [
      { id: 'bagels_everything', name: 'Everything bagels, 6 ct', price: 499 },
      { id: 'bagels_bakery', name: 'Bakery-fresh bagels, 6 ct', price: 699 },
    ],
  },
  // Pantry
  { id: 'spaghetti', name: 'Spaghetti, 1 lb', unit: 'each', price: 250, weighed: false, substitutable: false, category: 'Pantry' },
  { id: 'olive_oil', name: 'Extra virgin olive oil, 500 ml', unit: 'each', price: 750, weighed: false, substitutable: false, category: 'Pantry' },
  {
    id: 'coffee', name: 'Whole bean coffee, 12 oz', unit: 'each', price: 1199, weighed: false, substitutable: true, category: 'Pantry',
    substitutes: [
      { id: 'coffee_medium', name: 'Medium roast coffee, 12 oz', price: 1099 },
      { id: 'coffee_single', name: 'Single-origin coffee, 12 oz', price: 1499 },
    ],
  },
];

export const CATALOG_BY_ID = Object.fromEntries(CATALOG.map((item) => [item.id, item]));

export function findSubstitute(itemId, substituteId) {
  return CATALOG_BY_ID[itemId]?.substitutes?.find((s) => s.id === substituteId) ?? null;
}

// The demo basket preloaded in the store. It reproduces the PRD worked example:
// items $50.00 ($30.00 substitutable, $10.00 weighed), estimate $62.00.
// The customer has opted in to "up to $3 more" on oat milk (D13), so the hold is $70.68:
// weight buffer $2.00 + substitution buffer $3.68 + oat milk opt-in $3.00.
// `qty` counts units for fixed-price items; `estLb` is the estimated weight for weighed items.
export const DEMO_CART = [
  { itemId: 'onions', estLb: 2.0 },
  { itemId: 'bananas', estLb: 3.0 },
  { itemId: 'apples', estLb: 2.5 },
  { itemId: 'strawberries', qty: 1 },
  { itemId: 'oatmilk', qty: 1, allowUpgrade: true },
  { itemId: 'yogurt', qty: 1 },
  { itemId: 'eggs', qty: 1 },
  { itemId: 'sourdough', qty: 1 },
  { itemId: 'spaghetti', qty: 1 },
  { itemId: 'olive_oil', qty: 1 },
];

// Shopper outcomes that reproduce the PRD's "after picking" column:
// strawberries out of stock, bananas came in lighter, oat milk swapped for a brand $1.59 dearer
// (allowed only because the customer opted in; "similar price" alone would cap it at $6.31).
// Final total: $58.25, so $12.43 of the $70.68 hold is released.
export const DEMO_PICKS = {
  strawberries: { status: 'out_of_stock' },
  bananas: { status: 'found', actualLb: 2.6 },
  oatmilk: { status: 'substituted', substituteId: 'oatmilk_barista' },
};

// A swap that must be refused: far above what the customer approved for oat milk.
export const DEMO_BLOCKED_PICK = {
  oatmilk: { status: 'substituted', substituteId: 'oatmilk_smallbatch' },
};

export const TIP_PRESETS = [0, 300, 450, 600];
export const DEFAULT_TIP = 450;
