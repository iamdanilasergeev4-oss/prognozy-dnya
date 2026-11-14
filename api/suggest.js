// Vercel Serverless Function: принимает предложение с сайта и пересылает его в Telegram.
// Нужны переменные окружения в Vercel: TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Метод не поддерживается" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(500).json({ ok: false, error: "Бот не настроен на сервере" });
  }

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // Ловушка для спам-ботов: настоящий пользователь это поле не видит и не заполняет
  if (body.website) return res.status(200).json({ ok: true });

  const message = String(body.message || "").trim();
  const contact = String(body.contact || "").trim();
  if (message.length < 3) {
    return res.status(400).json({ ok: false, error: "Напишите предложение" });
  }
  if (message.length > 2000 || contact.length > 100) {
    return res.status(400).json({ ok: false, error: "Слишком длинный текст" });
  }

  const time = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const text =
    `📩 Новое предложение с сайта\n\n${message}\n\n` +
    `👤 Контакт: ${contact || "не указан"}\n🕒 ${time} (МСК)`;

  try {
    const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const data = await tg.json();
    if (!data.ok) {
      console.error("Telegram error:", data);
      return res.status(502).json({ ok: false, error: "Не удалось отправить, попробуйте позже" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ ok: false, error: "Не удалось отправить, попробуйте позже" });
  }
};
