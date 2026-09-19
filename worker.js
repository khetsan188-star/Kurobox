function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(
    new RegExp("(^|;\\s*)" + name + "=([^;]*)")
  );
  return match ? decodeURIComponent(match[2]) : null;
}

function makeToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}

function makeSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(str) {
  const binary = atob(str);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 120000,
      hash: "SHA-256"
    },
    key,
    256
  );

  return bytesToBase64(new Uint8Array(bits));
}

async function createPasswordHash(password) {
  const salt = makeSalt();
  const hash = await hashPassword(password, salt);
  return `${bytesToBase64(salt)}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [salt64, savedHash] = stored.split(":");
  if (!salt64 || !savedHash) return false;

  const salt = base64ToBytes(salt64);
  const hash = await hashPassword(password, salt);

  return hash === savedHash;
}

async function getUser(request, env) {
  const token = getCookie(request, "kurobox_session");
  if (!token || !env.DB) return null;

  const result = await env.DB
    .prepare(`
      SELECT
        u.id,
        u.email,
        u.coins
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
        AND s.expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `)
    .bind(token)
    .first();

  return result || null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================
    // HEALTH
    // =========================
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "KuroBox",
        version: "v8",
        database: Boolean(env.DB)
      });
    }

    if (!env.DB) {
      if (url.pathname.startsWith("/api/")) {
        return json(
          { ok: false, error: "D1 database belum terhubung" },
          500
        );
      }
    }

    // =========================
    // REGISTER
    // =========================
    if (url.pathname === "/api/register" && request.method === "POST") {
      try {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        if (!email || !password) {
          return json(
            { ok: false, error: "Email dan password wajib diisi" },
            400
          );
        }

        if (password.length < 6) {
          return json(
            { ok: false, error: "Password minimal 6 karakter" },
            400
          );
        }

        const existing = await env.DB
          .prepare("SELECT id FROM users WHERE email = ?")
          .bind(email)
          .first();

        if (existing) {
          return json(
            { ok: false, error: "Email sudah terdaftar" },
            409
          );
        }

        const passwordHash = await createPasswordHash(password);

        const result = await env.DB
          .prepare(`
            INSERT INTO users (email, password_hash, coins)
            VALUES (?, ?, 0)
          `)
          .bind(email, passwordHash)
          .run();

        return json({
          ok: true,
          message: "Akun berhasil dibuat",
          user_id: result.meta.last_row_id
        });
      } catch (error) {
        return json(
          { ok: false, error: error.message },
          500
        );
      }
    }

    // =========================
    // LOGIN
    // =========================
    if (url.pathname === "/api/login" && request.method === "POST") {
      try {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");

        const user = await env.DB
          .prepare(`
            SELECT id, email, password_hash, coins
            FROM users
            WHERE email = ?
            LIMIT 1
          `)
          .bind(email)
          .first();

        if (!user || !(await verifyPassword(password, user.password_hash))) {
          return json(
            { ok: false, error: "Email atau password salah" },
            401
          );
        }

        const token = makeToken();

        await env.DB
          .prepare(`
            INSERT INTO sessions (user_id, token, expires_at)
            VALUES (?, ?, datetime('now', '+7 days'))
          `)
          .bind(user.id, token)
          .run();

        return json(
          {
            ok: true,
            user: {
              id: user.id,
              email: user.email,
              coins: user.coins
            }
          },
          200,
          {
            "Set-Cookie":
              `kurobox_session=${encodeURIComponent(token)}; ` +
              `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
          }
        );
      } catch (error) {
        return json(
          { ok: false, error: error.message },
          500
        );
      }
    }

    // =========================
    // LOGOUT
    // =========================
    if (url.pathname === "/api/logout" && request.method === "POST") {
      const token = getCookie(request, "kurobox_session");

      if (token) {
        await env.DB
          .prepare("DELETE FROM sessions WHERE token = ?")
          .bind(token)
          .run();
      }

      return json(
        { ok: true },
        200,
        {
          "Set-Cookie":
            "kurobox_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
        }
      );
    }

    // =========================
    // ME
    // =========================
    if (url.pathname === "/api/me") {
      const user = await getUser(request, env);

      if (!user) {
        return json(
          { ok: false, error: "Belum login" },
          401
        );
      }

      return json({
        ok: true,
        user
      });
    }

    // =========================
    // BOXES
    // =========================
    if (url.pathname === "/api/boxes") {
      try {
        const result = await env.DB
          .prepare(`
            SELECT
              id,
              name,
              cost_coins,
              active
            FROM gacha_boxes
            WHERE active = 1
            ORDER BY id ASC
          `)
          .all();

        return json({
          ok: true,
          boxes: result.results || []
        });
      } catch (error) {
        return json(
          { ok: false, error: error.message },
          500
        );
      }
    }

    // =========================
    // BOX ITEMS
    // =========================
    if (url.pathname === "/api/box-items") {
      const boxId = url.searchParams.get("box_id");

      if (!boxId) {
        return json(
          { ok: false, error: "box_id wajib diisi" },
          400
        );
      }

      try {
        const result = await env.DB
          .prepare(`
            SELECT
              id,
              box_id,
              name,
              rarity,
              probability,
              stock
            FROM gacha_items
            WHERE box_id = ?
            ORDER BY id ASC
          `)
          .bind(boxId)
          .all();

        return json({
          ok: true,
          items: result.results || []
        });
      } catch (error) {
        return json(
          { ok: false, error: error.message },
          500
        );
      }
    }

    // =========================
    // GACHA
    // =========================
    if (url.pathname === "/api/gacha" && request.method === "POST") {
      try {
        const user = await getUser(request, env);

        if (!user) {
          return json(
            { ok: false, error: "Silakan login terlebih dahulu" },
            401
          );
        }

        const body = await request.json();
        const boxId = Number(body.box_id);

        if (!Number.isInteger(boxId)) {
          return json(
            { ok: false, error: "box_id tidak valid" },
            400
          );
        }

        const box = await env.DB
          .prepare(`
            SELECT id, name, cost_coins
            FROM gacha_boxes
            WHERE id = ? AND active = 1
            LIMIT 1
          `)
          .bind(boxId)
          .first();

        if (!box) {
          return json(
            { ok: false, error: "Box tidak ditemukan" },
            404
          );
        }

        const itemsResult = await env.DB
          .prepare(`
            SELECT
              id,
              name,
              rarity,
              probability,
              stock
            FROM gacha_items
            WHERE box_id = ?
              AND stock > 0
              AND probability > 0
          `)
          .bind(boxId)
          .all();

        const items = itemsResult.results || [];

        if (items.length === 0) {
          return json(
            { ok: false, error: "Tidak ada hadiah yang tersedia di box ini" },
            400
          );
        }

        // Weighted random berdasarkan probability
        const totalProbability = items.reduce(
          (sum, item) => sum + Number(item.probability),
          0
        );

        let random = Math.random() * totalProbability;
        let selected = items[items.length - 1];

        for (const item of items) {
          random -= Number(item.probability);

          if (random <= 0) {
            selected = item;
            break;
          }
        }

        // Kurangi coin secara aman
        const coinUpdate = await env.DB
          .prepare(`
            UPDATE users
            SET coins = coins - ?
            WHERE id = ?
              AND coins >= ?
          `)
          .bind(box.cost_coins, user.id, box.cost_coins)
          .run();

        if (!coinUpdate.meta.changes) {
          return json(
            {
              ok: false,
              error: "Coin tidak cukup",
              required: box.cost_coins
            },
            400
          );
        }

        // Kurangi stock
        const stockUpdate = await env.DB
          .prepare(`
            UPDATE gacha_items
            SET stock = stock - 1
            WHERE id = ?
              AND stock > 0
          `)
          .bind(selected.id)
          .run();

        if (!stockUpdate.meta.changes) {
          // Refund kalau stock keburu habis
          await env.DB
            .prepare(`
              UPDATE users
              SET coins = coins + ?
              WHERE id = ?
            `)
            .bind(box.cost_coins, user.id)
            .run();

          return json(
            {
              ok: false,
              error: "Hadiah tersebut baru saja habis. Silakan coba lagi."
            },
            409
          );
        }

        // Simpan hadiah
        await env.DB
          .prepare(`
            INSERT INTO inventory (user_id, item_id, status)
            VALUES (?, ?, 'won')
          `)
          .bind(user.id, selected.id)
          .run();

        // Catat coin
        await env.DB
          .prepare(`
            INSERT INTO coin_ledger
              (user_id, amount, type, reference)
            VALUES (?, ?, 'gacha', ?)
          `)
          .bind(
            user.id,
            -box.cost_coins,
            `box:${box.id}:item:${selected.id}`
          )
          .run();

        const newUser = await env.DB
          .prepare(`
            SELECT id, email, coins
            FROM users
            WHERE id = ?
          `)
          .bind(user.id)
          .first();

        return json({
          ok: true,
          message: "Gacha berhasil!",
          box: {
            id: box.id,
            name: box.name
          },
          reward: {
            id: selected.id,
            name: selected.name,
            rarity: selected.rarity
          },
          user: newUser
        });
      } catch (error) {
        return json(
          { ok: false, error: error.message },
          500
        );
      }
    }

    // =========================
    // INVENTORY
    // =========================
    if (url.pathname === "/api/inventory") {
      try {
        const user = await getUser(request, env);

        if (!user) {
          return json(
            { ok: false, error: "Silakan login terlebih dahulu" },
            401
          );
        }

        const result = await env.DB
          .prepare(`
            SELECT
              i.id,
              i.status,
              i.created_at,
              g.name,
              g.rarity,
              g.image_url
            FROM inventory i
            JOIN gacha_items g ON g.id = i.item_id
            WHERE i.user_id = ?
            ORDER BY i.id DESC
          `)
          .bind(user.id)
          .all();

        return json({
          ok: true,
          inventory: result.results || []
        });
      } catch (error) {
        return json(
          { ok: false, error: error.message },
          500
        );
      }
    }

    // =========================
    // ASSETS / WEBSITE
    // =========================
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("KuroBox is running.", {
      headers: {
        "content-type": "text/plain"
      }
    });
  }
};
