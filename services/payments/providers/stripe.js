// services/payments/providers/stripe.js
const PaymentProvider = require('../provider');

let stripe;
try {
  const Stripe = require('stripe');
  stripe = Stripe(process.env.STRIPE_SECRET_KEY);
} catch {
  stripe = null;
}

class StripeProvider extends PaymentProvider {
  constructor() {
    super({});
    this.name = 'stripe';
  }

  _check() {
    if (!stripe) throw new Error('Stripe SDK not installed. Run: npm install stripe');
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
  }

  async createSubscription(plan, customer, successUrl, cancelUrl) {
    this._check();
    const priceId = plan.provider_price_id || process.env.STRIPE_PRICE_ID;
    if (!priceId) throw new Error('No Stripe price ID configured for this plan');

    const session = await stripe.checkout.sessions.create({
      customer_email: customer.email,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { user_id: customer.userId, plan_id: plan.id },
    });

    return {
      checkoutUrl: session.url,
      providerSubscriptionId: session.id,
    };
  }

  async cancelSubscription(providerSubscriptionId) {
    this._check();
    const sub = await stripe.subscriptions.cancel(providerSubscriptionId);
    return { status: sub.status };
  }

  async createPaymentIntent(amount, currency, metadata) {
    this._check();
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: currency.toLowerCase(),
      metadata,
    });
    return { clientSecret: intent.client_secret, providerPaymentId: intent.id };
  }

  async confirmPayment(paymentIntentId) {
    this._check();
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return { status: intent.status, amount: intent.amount };
  }

  async getSubscription(providerSubscriptionId) {
    this._check();
    const sub = await stripe.subscriptions.retrieve(providerSubscriptionId);
    return {
      status: sub.status,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      cancel_at_period_end: sub.cancel_at_period_end,
    };
  }

  async handleWebhook(payload, signature) {
    this._check();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

    const event = stripe.webhooks.constructEvent(payload, signature, secret);
    return {
      type: event.type,
      data: event.data.object,
    };
  }

  async getCustomerPortalUrl(customerId, returnUrl) {
    this._check();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }
}

module.exports = new StripeProvider();
