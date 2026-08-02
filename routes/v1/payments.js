// routes/v1/payments.js
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { auditLog } = require('../../middleware/security');
const subscriptionService = require('../../services/subscription');
const { getProvider } = require('../../services/payments');

const router = express.Router();

// Webhooks - no auth required
router.post('/webhooks/:provider', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const providerName = req.params.provider;
    const provider = getProvider(providerName);
    const signature = req.headers['stripe-signature'] || req.headers['paypal-auth-algo'] || '';

    const result = await provider.handleWebhook(req.body, signature);

    // Process webhook event
    if (result.type === 'checkout.session.completed' || result.type === 'payment.succeeded') {
      const metadata = result.data.metadata || {};
      const userId = metadata.user_id;
      const planId = metadata.plan_id;

      if (userId && planId) {
        await subscriptionService.createSubscription(
          parseInt(userId),
          parseInt(planId),
          providerName,
          result.data.subscription || result.data.id,
          result.data.current_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        );

        await subscriptionService.recordPayment(
          parseInt(userId),
          null,
          providerName,
          result.data.id,
          result.data.amount_total || result.data.amount || 0,
          result.data.currency?.toUpperCase() || 'USD',
          'succeeded',
          'Subscription payment',
          metadata
        );
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`[payments/webhook/${req.params.provider}]`, err);
    res.status(400).json({ error: 'Webhook processing failed' });
  }
});

// POST /api/v1/payments/intent
router.post('/intent', requireAuth, auditLog('payment.create_intent'), async (req, res) => {
  try {
    const { amount, currency, provider: providerName } = req.body || {};
    if (!amount || !currency) {
      return res.status(400).json({ error: 'amount and currency required' });
    }

    const provider = getProvider(providerName || 'stripe');
    const intent = await provider.createPaymentIntent(amount, currency, {
      userId: req.userId,
      reference: `spider-${req.userId}-${Date.now()}`,
    });

    res.json(intent);
  } catch (err) {
    console.error('[payments/intent]', err);
    res.status(500).json({ error: err.message || 'Payment intent failed' });
  }
});

// POST /api/v1/payments/confirm
router.post('/confirm', requireAuth, auditLog('payment.confirm'), async (req, res) => {
  try {
    const { paymentIntentId, provider: providerName } = req.body || {};
    if (!paymentIntentId) return res.status(400).json({ error: 'paymentIntentId required' });

    const provider = getProvider(providerName || 'stripe');
    const result = await provider.confirmPayment(paymentIntentId);
    res.json(result);
  } catch (err) {
    console.error('[payments/confirm]', err);
    res.status(500).json({ error: err.message || 'Payment confirmation failed' });
  }
});

module.exports = router;
