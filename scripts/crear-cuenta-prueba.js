// Crea (o reinicia) la cuenta de prueba en el plan gratis y muestra su contraseña.
// Uso en el servidor:  sudo -u atalaya env $(sudo cat /etc/atalaya.env | xargs) DATA_DIR=/var/lib/atalaya node scripts/crear-cuenta-prueba.js
import crypto from 'node:crypto';
const { migrate, db, now } = await import('../src/lib/db.js');
const { hashPassword } = await import('../src/lib/auth.js');
migrate();
const email = process.argv[2] || 'prueba@ejemplo.com';
const pass = 'prueba-' + crypto.randomBytes(5).toString('hex');
const hash = await hashPassword(pass);
const t = now();
const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (ex) {
  db.prepare("UPDATE users SET password_hash = ?, plan = 'gratis', credits = 5, credits_renew_at = ? WHERE id = ?").run(hash, t + 30 * 86400, ex.id);
  db.prepare("UPDATE subscriptions SET status = 'canceled', renews_at = NULL WHERE user_id = ?").run(ex.id);
} else {
  const r = db.prepare("INSERT INTO users (name, email, password_hash, role, plan, credits, credits_renew_at, created_at) VALUES ('Prueba', ?, ?, 'member', 'gratis', 5, ?, ?)").run(email, hash, t + 30 * 86400, t);
  db.prepare('INSERT INTO notification_prefs (user_id, push_enabled, updated_at) VALUES (?, 0, ?)').run(Number(r.lastInsertRowid), t);
}
console.log(`Cuenta de prueba lista\n  correo:     ${email}\n  contraseña: ${pass}\n  plan:       Gratis, 5 créditos`);
