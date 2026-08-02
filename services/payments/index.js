// services/payments/index.js
const PaymentProvider = require('./provider');

const PROVIDERS = {
  stripe: () => require('./providers/stripe'),
  paypal: () => require('./providers/paypal'),
  ecocash: () => require('./providers/ecocash'),
  onemoney: () => require('./providers/onemoney'),
  paynow: () => require('./providers/paynow'),
};

function getProvider(name) {
  const loader = PROVIDERS[name.toLowerCase()];
  if (!loader) throw new Error(`Unknown payment provider: ${name}. Available: ${Object.keys(PROVIDERS).join(', ')}`);
  return loader();
}

function getAvailableProviders() {
  const available = [];
  for (const [name, loader] of Object.entries(PROVIDERS)) {
    try {
      const p = loader();
      available.push({ name, label: name.charAt(0).toUpperCase() + name.slice(1) });
    } catch {
      // Provider not configured
    }
  }
  return available;
}

module.exports = { getProvider, getAvailableProviders, PaymentProvider };
