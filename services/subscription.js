// services/subscription.js
const { db } = require('../db/init');

class SubscriptionService {
  async getPlan(planId) {
    const result = await db.execute({
      sql: 'SELECT * FROM subscription_plans WHERE id = ? OR slug = ?',
      args: [planId, planId],
    });
    return result.rows[0] || null;
  }

  async getAllPlans() {
    const result = await db.execute({
      sql: 'SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY price_cents ASC',
    });
    return result.rows;
  }

  async getUserSubscription(userId) {
    const result = await db.execute({
      sql: `SELECT s.*, p.slug as plan_slug, p.name as plan_name, p.features_json,
              p.daily_message_limit, p.max_context_messages, p.voice_enabled,
              p.advanced_models, p.file_analysis, p.priority_support
            FROM subscriptions s
            JOIN subscription_plans p ON s.plan_id = p.id
            WHERE s.user_id = ?`,
      args: [userId],
    });
    return result.rows[0] || null;
  }

  async getUserPlan(userId) {
    const sub = await this.getUserSubscription(userId);
    if (sub) return sub;
    // Return free plan as default
    return this.getPlan('free');
  }

  async createSubscription(userId, planId, provider, providerSubId, periodEnd) {
    const plan = await this.getPlan(planId);
    if (!plan) throw new Error('Invalid plan');

    await db.execute({
      sql: `INSERT INTO subscriptions (user_id, plan_id, status, current_period_end, payment_provider, provider_subscription_id)
            VALUES (?, ?, 'active', ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              plan_id = excluded.plan_id,
              status = 'active',
              current_period_end = excluded.current_period_end,
              payment_provider = excluded.payment_provider,
              provider_subscription_id = excluded.provider_subscription_id,
              updated_at = datetime('now')`,
      args: [userId, plan.id, periodEnd, provider, providerSubId],
    });

    await db.execute({
      sql: 'UPDATE users SET current_plan_id = ? WHERE id = ?',
      args: [plan.id, userId],
    });

    return await this.getUserSubscription(userId);
  }

  async cancelSubscription(userId, atPeriodEnd = true) {
    const sub = await this.getUserSubscription(userId);
    if (!sub) throw new Error('No active subscription');

    if (atPeriodEnd) {
      await db.execute({
        sql: "UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = datetime('now') WHERE user_id = ?",
        args: [userId],
      });
    } else {
      await db.execute({
        sql: "UPDATE subscriptions SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?",
        args: [userId],
      });
      await db.execute({
        sql: 'UPDATE users SET current_plan_id = (SELECT id FROM subscription_plans WHERE slug = "free") WHERE id = ?',
        args: [userId],
      });
    }

    return await this.getUserSubscription(userId);
  }

  async recordPayment(userId, subscriptionId, provider, providerPaymentId, amountCents, currency, status, description, metadata = {}) {
    const result = await db.execute({
      sql: `INSERT INTO payments (user_id, subscription_id, provider, provider_payment_id, amount_cents, currency, status, description, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [userId, subscriptionId, provider, providerPaymentId, amountCents, currency, status, description, JSON.stringify(metadata)],
    });
    return { id: Number(result.lastInsertRowid) };
  }

  async getPaymentHistory(userId) {
    const result = await db.execute({
      sql: `SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC`,
      args: [userId],
    });
    return result.rows;
  }

  async getInvoices(userId) {
    const result = await db.execute({
      sql: `SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC`,
      args: [userId],
    });
    return result.rows;
  }

  async checkFeatureAccess(userId, feature) {
    const plan = await this.getUserPlan(userId);
    if (!plan) return false;
    const features = JSON.parse(plan.features_json || '{}');
    return features[feature] === true || plan[feature] === 1;
  }

  async getDashboardStats(userId) {
    const today = new Date().toISOString().split('T')[0];
    const [sub, usage, payments] = await Promise.all([
      this.getUserSubscription(userId),
      db.execute({
        sql: `SELECT * FROM usage_stats WHERE user_id = ? AND date = ?`,
        args: [userId, today],
      }),
      db.execute({
        sql: `SELECT COUNT(*) as total_payments, SUM(amount_cents) as total_spent FROM payments WHERE user_id = ? AND status = 'succeeded'`,
        args: [userId],
      }),
    ]);

    const plan = sub || await this.getPlan('free');
    const used = usage.rows[0] || { messages_sent: 0, messages_received: 0, voice_minutes_used: 0 };

    return {
      plan: {
        name: plan.plan_name || plan.name,
        slug: plan.plan_slug || plan.slug,
        status: plan.status || 'active',
        daily_message_limit: plan.daily_message_limit,
        voice_enabled: plan.voice_enabled === 1,
        advanced_models: plan.advanced_models === 1,
        file_analysis: plan.file_analysis === 1,
      },
      usage: {
        messages_sent: used.messages_sent || 0,
        messages_received: used.messages_received || 0,
        voice_minutes: used.voice_minutes_used || 0,
        remaining_messages: Math.max(0, (plan.daily_message_limit || 50) - (used.messages_sent || 0)),
      },
      billing: {
        total_payments: payments.rows[0]?.total_payments || 0,
        total_spent_cents: payments.rows[0]?.total_spent || 0,
      },
    };
  }
}

module.exports = new SubscriptionService();
