// services/payments/provider.js
// Common interface for all payment providers

class PaymentProvider {
  constructor(config) {
    this.config = config;
    this.name = 'base';
  }

  async createSubscription(plan, customer, successUrl, cancelUrl) {
    throw new Error('Not implemented');
  }

  async cancelSubscription(providerSubscriptionId) {
    throw new Error('Not implemented');
  }

  async createPaymentIntent(amount, currency, metadata) {
    throw new Error('Not implemented');
  }

  async confirmPayment(paymentIntentId) {
    throw new Error('Not implemented');
  }

  async getSubscription(providerSubscriptionId) {
    throw new Error('Not implemented');
  }

  async handleWebhook(payload, signature) {
    throw new Error('Not implemented');
  }

  async getCustomerPortalUrl(customerId, returnUrl) {
    throw new Error('Not implemented');
  }
}

module.exports = PaymentProvider;
