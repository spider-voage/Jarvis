// services/payments/providers/paynow.js
const PaymentProvider = require('../provider');

class PayNowProvider extends PaymentProvider {
  constructor() {
    super({});
    this.name = 'paynow';
    this.baseUrl = process.env.PAYNOW_API_URL || 'https://www.paynow.co.zw/interface/initiatetransaction';
  }

  _check() {
    if (!process.env.PAYNOW_ID || !process.env.PAYNOW_KEY) {
      throw new Error('PayNow credentials not configured');
    }
  }

  _generateHash(values, key) {
    const crypto = require('crypto');
    const str = Object.values(values).join('') + key;
    return crypto.createHash('sha512').update(str).digest('hex').toUpperCase();
  }

  async createPaymentIntent(amount, currency, metadata) {
    this._check();
    const values = {
      id: process.env.PAYNOW_ID,
      reference: metadata.reference || `spider-${Date.now()}`,
      amount: (amount / 100).toFixed(2),
      info: metadata.description || 'Spider AI Pro Subscription',
      returnurl: metadata.successUrl || `${process.env.APP_URL}/billing/success`,
      resulturl: metadata.webhookUrl || `${process.env.APP_URL}/api/v1/payments/webhooks/paynow`,
    };

    const hash = this._generateHash(values, process.env.PAYNOW_KEY);

    const formData = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) formData.append(k, v);
    formData.append('hash', hash);

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const text = await res.text();
    const params = new URLSearchParams(text);

    const status = params.get('status');
    if (status !== 'Ok') {
      throw new Error(`PayNow init failed: ${params.get('error') || text}`);
    }

    return {
      providerPaymentId: params.get('pollurl'),
      status: 'pending',
      checkoutUrl: params.get('browserurl'),
      requiresAction: true,
      actionType: 'redirect',
    };
  }

  async confirmPayment(pollUrl) {
    this._check();
    const res = await fetch(pollUrl);
    const text = await res.text();
    const params = new URLSearchParams(text);

    const status = params.get('status');
    return {
      status: status === 'Paid' ? 'succeeded' : status.toLowerCase(),
      amount: Math.round(parseFloat(params.get('amount') || 0) * 100),
    };
  }

  async createSubscription() {
    throw new Error('PayNow does not support subscriptions directly. Use payment intents with manual renewal.');
  }

  async cancelSubscription() {
    return { status: 'cancelled' };
  }

  async getSubscription() {
    return { status: 'active' };
  }

  async handleWebhook(payload) {
    // PayNow sends form-encoded data
    const params = new URLSearchParams(payload);
    return {
      type: params.get('status') === 'Paid' ? 'payment.succeeded' : 'payment.updated',
      data: {
        reference: params.get('reference'),
        amount: params.get('amount'),
        status: params.get('status'),
        pollurl: params.get('pollurl'),
      },
    };
  }

  async getCustomerPortalUrl() {
    return { url: null };
  }
}

module.exports = new PayNowProvider();
