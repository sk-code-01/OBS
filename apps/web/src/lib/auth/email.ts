import { Resend } from "resend";
import { getConfig } from "@/lib/config";

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (resendClient) return resendClient;
  resendClient = new Resend(getConfig().RESEND_API_KEY);
  return resendClient;
}

export async function sendMagicLinkEmail(email: string, token: string): Promise<void> {
  const url = new URL("/api/auth/verify", getConfig().PUBLIC_APP_URL);
  url.searchParams.set("token", token);

  await getResend().emails.send({
    from: "ClawObs <onboarding@resend.dev>",
    to: email,
    subject: "Your ClawObs sign-in link",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #11211d;">
        <h1 style="margin-bottom: 8px;">Open your ClawObs dashboard</h1>
        <p style="margin-top: 0;">This sign-in link expires in 15 minutes.</p>
        <p>
          <a
            href="${url.toString()}"
            style="display:inline-block;padding:12px 18px;background:#115e52;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;"
          >
            Sign in to ClawObs
          </a>
        </p>
        <p style="font-size: 14px; color: #556865;">
          If you did not request this, you can safely ignore the email.
        </p>
      </div>
    `,
  });
}
