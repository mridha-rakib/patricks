/// <reference path="../pb_data/types.d.ts" />
const authFrontendBaseUrl = () => {
  const configured = String($os.getenv("FRONTEND_URL") || $os.getenv("PUBLIC_FRONTEND_URL") || "").trim();
  return (configured || "https://zahniboerse.com").replace(/\/+$/, "");
};

const getTokenFromUrl = (url) => {
  const raw = String(url || "");
  const queryMatch = raw.match(/[?&]token=([^&#]+)/);
  if (queryMatch) {
    return queryMatch[1];
  }

  const pathMatch = raw.match(/\/([A-Za-z0-9._~-]{20,})(?:[/?#]|$)/);
  return pathMatch ? pathMatch[1] : "";
};

const getAuthActionToken = (event) => {
  const meta = event.meta || {};
  const actionUrl = String(meta.actionUrl || meta.actionURL || meta.url || "");
  return String(meta.token || getTokenFromUrl(actionUrl) || "").trim();
};

const rewriteAuthActionMessage = (event, path) => {
  const token = getAuthActionToken(event);
  if (!token) {
    $app.logger().warn("Auth email token missing; frontend auth link could not be rewritten", "path", path);
    return;
  }

  const meta = event.meta || {};
  const actionUrl = String(meta.actionUrl || meta.actionURL || meta.url || "");
  const frontendUrl = `${authFrontendBaseUrl()}${path}?token=${encodeURIComponent(token)}`;

  const rewrite = (value) => {
    let next = String(value || "");
    if (!next) {
      return next;
    }

    if (actionUrl) {
      next = next.split(actionUrl).join(frontendUrl);
    }

    return next
      .replace(/https?:\/\/[^"'\s<>]+\/api\/collections\/users\/confirm-password-reset\?token=[^"'\s<>]+/g, frontendUrl)
      .replace(/https?:\/\/[^"'\s<>]+\/api\/collections\/users\/confirm-verification\?token=[^"'\s<>]+/g, frontendUrl)
      .replace(/https?:\/\/[^"'\s<>]+\/_\/#\/auth\/confirm-password-reset\/[^"'\s<>]+/g, frontendUrl)
      .replace(/https?:\/\/[^"'\s<>]+\/_\/#\/auth\/confirm-verification\/[^"'\s<>]+/g, frontendUrl);
  };

  event.message.html = rewrite(event.message.html);
  event.message.text = rewrite(event.message.text);
};

onMailerRecordPasswordResetSend((event) => {
  rewriteAuthActionMessage(event, "/auth/reset-password");
  return event.next();
}, "users");

onMailerRecordVerificationSend((event) => {
  rewriteAuthActionMessage(event, "/auth/verify-email");
  return event.next();
}, "users");
