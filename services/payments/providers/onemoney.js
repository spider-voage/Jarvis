// services/payments/providers/onemoney.js
const PaymentProvider = require('../provider');

class OneMoneyProvider extends PaymentProvider {
  constructor() {
    super({});
    this.name = 'onemoney';
    this.baseUrl = process.env.ONEMONEY_API_URL || 'https://api.onemoney.co.zw';
  }

  _check() {
    if (!process.env.ONEMONEY_API_KEY || !process.env.ONEMONEY_MERCHANT_ID) {
      throw new Error('OneMoney credentials not configured');
    }
  }

  async createPaymentIntent(amount, currency, metadata) {
    this._check();
    const res = await fetch(`${this.baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ONEMONEY_API_KEY}`,
      },
      body: JSON.stringify({
        merchant_id: process.env.ONEMONEY_MERCHANT_ID,
        amount: (amount / 100).toFixed(2),
        currency: currency.toUpperCase(),
        reference: metadata.reference || `spider-${Date.now()}`,
        phone: metadata.phone,
        description: metadata.description || 'Spider AI Pro Subscription',
        callback_url: metadata.callbackUrl,
      }),
    });

    const data = await res.json();
    return {
      providerPaymentId: data.transaction_id || data.reference,
      status: data.status || 'pending',
      checkoutUrl: data.payment_url,
      requiresAction: true,
      actionType: 'mobile_push',
      phone: metadata.phone,
    };
  }

  async confirmPayment(paymentIntentId) {
    this._check();
    const res = await fetch(`${this.baseUrl}/api/v1/payments/${paymentIntentId}`, {
      headers: { 'Authorization': `Bearer ${process.env.ONEMONEY_API_KEY}` },
    });
    const data = await res.json();
    return {
      status: data.status === 'SUCCESS' ? 'succeeded' : data.status.toLowerCase(),
      amount: Math.round(parseFloat(data.amount) * 100),
    };
  }

  async createSubscription() {
    throw new Error('OneMoney does not support subscriptions directly. Use payment intents with manual renewal.');
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

module.exports = new OneMoneyProvider();
