import "server-only";

import webpush from "web-push";
import {
  GENERIC_PUSH_PAYLOAD,
  type SenderConfig,
} from "@/lib/babylon/notification-delivery";

export interface GenericPushResult {
  ok: boolean;
  permanent: boolean;
}

export async function sendGenericPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  config: SenderConfig
): Promise<GenericPushResult> {
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      GENERIC_PUSH_PAYLOAD
    );
    return { ok: true, permanent: false };
  } catch (error) {
    const statusCode =
      error instanceof webpush.WebPushError ? error.statusCode : null;
    return {
      ok: false,
      permanent: statusCode === 404 || statusCode === 410,
    };
  }
}
