// services/payments/providers/paypal.js
const PaymentProvider = require('../provider');

const PAYPAL_BASE = process.env.PAYPAL_SANDBOX === 'true'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

class PayPalProvider extends PaymentProvider {
  constructor() {
    super({});
    this.name = 'paypal';
    this.accessToken = null;
    this.tokenExpiry = 0;
  }

  _check() {
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      throw new Error('PayPal credentials not configured');
    }
  }

  async _getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;

    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });

    const data = await res.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
    return this.accessToken;
  }

  async createSubscription(plan, customer, successUrl, cancelUrl) {
    this._check();
    const token = await this._getAccessToken();
    const planId = plan.provider_price_id || process.env.PAYPAL_PLAN_ID;
    if (!planId) throw new Error('No PayPal plan ID configured');

    const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: planId,
        subscriber: { name: { given_name: customer.name || 'User' }, email_address: customer.email },
        application_context: {
          brand_name: 'Spider AI',
          return_url: successUrl,
          cancel_url: cancelUrl,
        },
      }),
    });

    const data = await res.json();
    return {
      checkoutUrl: data.links.find(l => l.rel === 'approve')?.href,
      providerSubscriptionId: data.id,
    };
  }

  async cancelSubscription(providerSubscriptionId) {
    this._check();
    const token = await this._getAccessToken();
    await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions/${providerSubscriptionId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'User requested cancellation' }),
    });
    return { status: 'cancelled' };
  }

  async createPaymentIntent(amount, currency, metadata) {
    this._check();
    const token = await this._getAccessToken();
    const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: currency.toUpperCase(), value: (amount / 100).toFixed(2) },
          custom_id: JSON.stringify(metadata),
        }],
      }),
    });
    const data = await res.json();
    return { providerPaymentId: data.id, status: data.status };
  }

  async confirmPayment(paymentIntentId) {
    this._check();
    const token = await this._getAccessToken();
    const res = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${paymentIntentId}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    return { status: data.status, amount: Math.round(parseFloat(data.purchase_units[0].payments.captures[0].amount.value) * 100) };
  }

  async getSubscription(providerSubscriptionId) {
    this._check();
    const token = await this._getAccessToken();
    const res = await fetch(`${PAYPAL_BASE}/v1/billing/subscriptions/${providerSubscriptionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return {
      status: data.status,
      current_period_end: data.billing_info?.next_billing_time,
      cancel_at_period_end: data.status === 'CANCELLED',
    };
  }

  async handleWebhook(payload, signature) {
    // PayPal webhooks use basic auth or certificate verification
    // Simplified: return raw payload for route-level processing
    return { type: payload.event_type, data: payload.resource };
  }

  async getCustomerPortalUrl() {
    // PayPal does not have a customer portal like Stripe
    return { url: null };
  }
}

module.exports = new PayPalProvider();
