// services/payments/providers/ecocash.js
const PaymentProvider = require('../provider');

class EcoCashProvider extends PaymentProvider {
  constructor() {
    super({});
    this.name = 'ecocash';
    this.baseUrl = process.env.ECOCASH_API_URL || 'https://api.ecocash.co.zw';
  }

  _check() {
    if (!process.env.ECOCASH_API_KEY || !process.env.ECOCASH_MERCHANT_ID) {
      throw new Error('EcoCash credentials not configured');
    }
  }

  async createPaymentIntent(amount, currency, metadata) {
    this._check();
    // EcoCash uses mobile number + USSD push
    const res = await fetch(`${this.baseUrl}/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.ECOCASH_API_KEY,
      },
      body: JSON.stringify({
        merchant_id: process.env.ECOCASH_MERCHANT_ID,
        amount: (amount / 100).toFixed(2),
        currency: currency.toUpperCase(),
        reference: metadata.reference || `spider-${Date.now()}`,
        phone: metadata.phone,
        description: metadata.description || 'Spider AI Pro Subscription',
      }),
    });

    const data = await res.json();
    return {
      providerPaymentId: data.transaction_id || data.reference,
      status: data.status || 'pending',
      checkoutUrl: data.ussd_prompt ? null : data.payment_url,
      requiresAction: true,
      actionType: 'ussd_push',
      phone: metadata.phone,
    };
  }

  async confirmPayment(paymentIntentId) {
    this._check();
    const res = await fetch(`${this.baseUrl}/v1/payments/${paymentIntentId}`, {
      headers: { 'X-API-Key': process.env.ECOCASH_API_KEY },
    });
    const data = await res.json();
    return {
      status: data.status === 'SUCCESS' ? 'succeeded' : data.status.toLowerCase(),
      amount: Math.round(parseFloat(data.amount) * 100),
    };
  }

  async createSubscription() {
    // EcoCash does not support native subscriptions
    // Use createPaymentIntent + manual renewal tracking
    throw new Error('EcoCash does not support subscriptions directly. Use payment intents with manual renewal.');
  }

  async cancelSubscription() {
    return { status: 'cancelled' };
  }

  async getSubscription() {
    return { status: 'active' };
  }

  async handleWebhook(payload) {
    return { type: payload.event || 'payment.update', data: payload };
  }

  async getCustomerPortalUrl() {
    return { url: null };
  }
}

module.exports = new EcoCashProvider();
