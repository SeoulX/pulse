import nodemailer from "nodemailer";
import type { IEndpoint } from "@/lib/models/endpoint";
import type { CheckResultData } from "@/types";
import Notification from "@/lib/models/notification";

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

export async function processNotifications(
  endpoint: IEndpoint,
  result: CheckResultData
): Promise<void> {
  if (!endpoint.alertEnabled) return;

  const wasAlerting = endpoint.isAlerting;
  const isNowUp = result.status === "UP";

  // Recovery notification
  if (wasAlerting && isNowUp) {
    await sendToChannels(endpoint, "recovery", result);
    endpoint.isAlerting = false;
    await endpoint.save();
    return;
  }

  // Alert notification
  if (
    endpoint.consecutiveFailures >= endpoint.alertThreshold &&
    !wasAlerting
  ) {
    // Rate limit check
    if (
      endpoint.lastAlertedAt &&
      Date.now() - endpoint.lastAlertedAt.getTime() < RATE_LIMIT_MS
    ) {
      return;
    }

    await sendToChannels(endpoint, "alert", result);
    endpoint.isAlerting = true;
    endpoint.lastAlertedAt = new Date();
    await endpoint.save();
  }
}

async function sendToChannels(
  endpoint: IEndpoint,
  type: "alert" | "recovery",
  result: CheckResultData
): Promise<void> {
  const message =
    type === "alert"
      ? `[ALERT] ${endpoint.name} is ${result.status} (${endpoint.consecutiveFailures} consecutive failures)`
      : `[RECOVERED] ${endpoint.name} is back UP`;

  const promises: Promise<void>[] = [];

  if (endpoint.notifications?.email?.enabled && endpoint.notifications.email.address) {
    promises.push(
      sendEmail(endpoint.notifications.email.address, message, endpoint, type)
    );
  }

  if (endpoint.notifications?.discord?.enabled && endpoint.notifications.discord.webhookUrl) {
    promises.push(
      sendDiscord(endpoint.notifications.discord.webhookUrl, message, endpoint, result, type)
    );
  }

  if (endpoint.notifications?.webhook?.enabled && endpoint.notifications.webhook.url) {
    promises.push(
      sendWebhook(endpoint.notifications.webhook.url, endpoint, result, type)
    );
  }

  await Promise.allSettled(promises);
}

async function sendEmail(
  to: string,
  message: string,
  endpoint: IEndpoint,
  type: "alert" | "recovery"
): Promise<void> {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || "Pulse <noreply@pulse.dev>",
      to,
      subject: message,
      text: `Endpoint: ${endpoint.name}\nURL: ${endpoint.url}\nStatus: ${endpoint.lastStatus}\nTime: ${new Date().toISOString()}`,
    });

    await logNotification(endpoint, "email", type, "sent", message);
  } catch (err) {
    await logNotification(
      endpoint,
      "email",
      type,
      "failed",
      message,
      (err as Error).message
    );
  }
}

async function sendDiscord(
  webhookUrl: string,
  message: string,
  endpoint: IEndpoint,
  result: CheckResultData,
  type: "alert" | "recovery"
): Promise<void> {
  const color = type === "alert" ? 0xff0000 : 0x00ff00;
  const payload = {
    embeds: [
      {
        title: message,
        color,
        fields: [
          { name: "Endpoint", value: endpoint.name, inline: true },
          { name: "URL", value: endpoint.url, inline: true },
          { name: "Status", value: result.status, inline: true },
          ...(type === "alert"
            ? [
                {
                  name: "Consecutive Failures",
                  value: String(endpoint.consecutiveFailures),
                  inline: true,
                },
              ]
            : []),
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await logNotification(endpoint, "discord", type, "sent", message);
  } catch (err) {
    await logNotification(
      endpoint,
      "discord",
      type,
      "failed",
      message,
      (err as Error).message
    );
  }
}

async function sendWebhook(
  url: string,
  endpoint: IEndpoint,
  result: CheckResultData,
  type: "alert" | "recovery"
): Promise<void> {
  const payload = {
    endpoint: endpoint.name,
    url: endpoint.url,
    status: result.status,
    consecutiveFailures: endpoint.consecutiveFailures,
    checkedAt: new Date().toISOString(),
    type,
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await logNotification(
      endpoint,
      "webhook",
      type,
      "sent",
      JSON.stringify(payload)
    );
  } catch (err) {
    await logNotification(
      endpoint,
      "webhook",
      type,
      "failed",
      JSON.stringify(payload),
      (err as Error).message
    );
  }
}

async function logNotification(
  endpoint: IEndpoint,
  channel: "email" | "discord" | "webhook",
  type: "alert" | "recovery",
  status: "sent" | "failed",
  message: string,
  error?: string
): Promise<void> {
  await Notification.create({
    endpointId: endpoint._id,
    channel,
    type,
    status,
    message,
    error: error || null,
  });
}
