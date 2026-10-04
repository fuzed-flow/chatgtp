// Prices used for new Fuzed Flow subscriptions. CAD prices remain recognizable
// for existing subscriptions and older signup links.
export const SUBSCRIPTION_CURRENCY = 'USD';
export const BASE_USER_LIMITS = { starter: 1, professional: 3, business: 10 };
export const SUBSCRIPTION_PRICES = {
  "starter": {
    "monthly": "price_1UMs7VIfI96QPT6lT0RLG9JI",
    "annual": "price_1UMs8KIfI96QPT6lP4aiTEwb",
    "legacy": {
      "monthly": "price_1UAK7EIfI96QPT6lL73xZqir",
      "annual": "price_1UAK7EIfI96QPT6lJNF9XNlx"
    }
  },
  "professional": {
    "monthly": "price_1UMs8NIfI96QPT6l4fb4CV40",
    "annual": "price_1UMs8SIfI96QPT6lCL8Uxd7b",
    "legacy": {
      "monthly": "price_1UAK7lIfI96QPT6lb0wHONs9",
      "annual": "price_1UAK8xIfI96QPT6lprie68A1"
    }
  },
  "business": {
    "monthly": "price_1UMs8VIfI96QPT6lKDent3gP",
    "annual": "price_1UMs8ZIfI96QPT6liR9UtHga",
    "legacy": {
      "monthly": "price_1UAKBOIfI96QPT6lOL13LhkJ",
      "annual": "price_1UAKBOIfI96QPT6lhwHxB4T3"
    }
  }
};

const priceDetails = new Map();
for (const [planId, prices] of Object.entries(SUBSCRIPTION_PRICES)) {
  for (const billingCycle of ['monthly', 'annual']) {
    const details = { planId, billingCycle, usdPriceId: prices[billingCycle] };
    priceDetails.set(prices[billingCycle], details);
    priceDetails.set(prices.legacy[billingCycle], details);
  }
}

export const getPlanIdFromPrice = (priceId) =>
  priceDetails.get(priceId)?.planId || 'starter';

export const getUsdPriceId = (priceId) =>
  priceDetails.get(priceId)?.usdPriceId || null;
