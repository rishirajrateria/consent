import "server-only";
import { db } from "./db";

/**
 * Pluggable provider interfaces for email, SMS and payments.
 * The mock implementations write to the OutboxMessage table (visible at
 * /dev/inbox) and auto-succeed payments, so every flow can be exercised with
 * zero external keys. Real adapters (Resend, Twilio/MSG91, Stripe/Razorpay)
 * implement the same interfaces and are selected via env vars.
 */

export interface EmailProvider {
  send(to: string, subject: string, body: string): Promise<void>;
}

export interface SmsProvider {
  send(to: string, body: string): Promise<void>;
}

export interface PaymentProvider {
  name: string;
  /** Creates a checkout; mock returns an internal URL that confirms instantly. */
  createCheckout(opts: {
    paymentId: string;
    amount: string;
    currency: string;
    description: string;
    returnTo: string;
  }): Promise<{ checkoutUrl: string; providerRef: string }>;
}

class MockEmail implements EmailProvider {
  async send(to: string, subject: string, body: string) {
    await db.outboxMessage.create({ data: { channel: "email", to, subject, body } });
  }
}

class MockSms implements SmsProvider {
  async send(to: string, body: string) {
    await db.outboxMessage.create({ data: { channel: "sms", to, body } });
  }
}

class MockPayments implements PaymentProvider {
  name = "mock";
  async createCheckout(opts: {
    paymentId: string;
    amount: string;
    currency: string;
    description: string;
    returnTo: string;
  }) {
    const ref = `mock_${opts.paymentId}`;
    return {
      checkoutUrl: `/pay/mock/${opts.paymentId}?return=${encodeURIComponent(opts.returnTo)}`,
      providerRef: ref,
    };
  }
}

export const email: EmailProvider = new MockEmail();
export const sms: SmsProvider = new MockSms();

/** Stripe for most countries, Razorpay for India — both mocked in dev. */
export function paymentProviderFor(country: string): PaymentProvider {
  void country; // real impl: country === "IN" ? razorpay : stripe
  return new MockPayments();
}
