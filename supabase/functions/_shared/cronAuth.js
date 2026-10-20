const sameSecret = (actual, expected) => {
  const a = new TextEncoder().encode(String(actual || ""));
  const b = new TextEncoder().encode(String(expected || ""));
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
};

export async function authorizeReminderCron(request, db) {
  const supplied = request.headers.get("X-Notification-Cron-Secret") || "";
  if (!supplied) return false;
  const { data, error } = await db.rpc("notification_delivery_server_config");
  const expected = data?.notification_cron_secret;
  return !error && typeof expected === "string" && expected.length >= 32
    && sameSecret(supplied, expected);
}
