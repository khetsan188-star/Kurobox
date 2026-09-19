const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH = "SHA-256";
const PBKDF2_SALT_LENGTH = 16;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function errorResponse(message, status = 400) {
  return json({
    ok: false,
    error: message
  }, status);
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";

  const parts = cookie.split(";").map(v => v.trim());

  for (const part of parts) {
    const index = part.indexOf("=");

    if (index === -1) continue;

    const key = part.slice(0, index);
    const value = part.slice(index + 1);

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function hashPassword(password) {
  const salt = new Uint8Array(PBKDF2_SALT_LENGTH);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH
    },
    keyMaterial,
    256
  );

  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(derivedBits))}`;
}

async function verifyPassword(password, storedHash) {
  try {
    let algorithm = "pbkdf2";
    let iterations = PBKDF2_ITERATIONS;
    let salt;
    let expectedHash;

    const parts = storedHash.split("$");

    // Format baru:
    // pbkdf2$100000$salt$hash
    if (parts.length === 4) {
      algorithm = parts[0];
      iterations = Number(parts[1]);
      salt = base64ToBytes(parts[2]);
      expectedHash = base64ToBytes(parts[3]);
    }

    // Format lama:
    // salt:hash
    else if (storedHash.includes(":")) {
      const legacyParts = storedHash.split(":");

      if (legacyParts.length !== 2) {
        return false;
      }

      salt = base64ToBytes(legacyParts[0]);
      expectedHash = base64ToBytes(legacyParts[1]);

      // Password lama dibuat dengan 100000 iterations
      iterations = 100000;
    }

    else {
      return false;
    }

    if (algorithm !== "pbkdf2") {
      return false;
    }

    if (!Number.isInteger(iterations) || iterations <= 0) {
      return false;
    }

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: PBKDF2_HASH
      },
      keyMaterial,
      expectedHash.length * 8
    );

    const actualHash = new Uint8Array(derivedBits);

    if (actualHash.length !== expectedHash.length) {
      return false;
    }

    let difference = 0;

    for (let i = 0; i < actualHash.length; i++) {
      difference |= actualHash[i] ^ expectedHash[i];
    }

    return difference === 0;

  } catch {
    return false;
  }
}

function sessionCookie(token) {
  return `session=${encodeURIComponent(token)}; Max-Age=${SESSION_DAYS * 24 * 60 * 60}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie() {
  return "session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";
}

async function getUser(request, env) {
  const token = getCookie(request, "session");

  if (!token) {
    return null;
  }

await env.DB
  .prepare(`
    INSERT INTO user_addresses (
      user_id,
      recipient_name,
      phone,
      address,
      city,
      province,
      postal_code
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id)
    DO UPDATE SET
      recipient_name = excluded.recipient_name,
      phone = excluded.phone,
      address = excluded.address,
      city = excluded.city,
      province = excluded.province,
      postal_code = excluded.postal_code,
      updated_at = CURRENT_TIMESTAMP
  `)
  .bind(
    user.id,
    recipientName,
    phone,
    address,
    city,
    province,
    postalCode
  )
  .run();

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validEmail(email) {
  return typeof email === "string"
    && email.length >= 3
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPassword(password) {
  return typeof password === "string"
    && password.length >= 8
    && password.length <= 200;
}

function chooseWeightedItem(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const normalized = items
    .map(item => ({
      ...item,
      probability: Number(item.probability)
    }))
    .filter(item =>
      Number.isFinite(item.probability) &&
      item.probability > 0 &&
      Number(item.stock) > 0
    );

  if (normalized.length === 0) {
    return null;
  }

  const total = normalized.reduce(
    (sum, item) => sum + item.probability,
    0
  );

  if (total <= 0) {
    return null;
  }

  const random = Math.random() * total;

  let cursor = 0;

  for (const item of normalized) {
    cursor += item.probability;

    if (random < cursor) {
      return item;
    }
  }

  return normalized[normalized.length - 1];
}

function sanitizeItem(item) {
  return {
    id: item.id,
    box_id: item.box_id,
    name: item.name,
    image_url: item.image_url ?? null,
    probability: Number(item.probability),
    stock: Number(item.stock),
    rarity: item.rarity || "Common"
  };
}
async function handleHealth(env) {
  let database = false;

  try {
    await env.DB
      .prepare("SELECT 1 AS ok")
      .first();

    database = true;
  } catch {
    database = false;
  }

  return json({
    ok: true,
    app: "KuroBox",
    version: "v10",
    database
  });
}

async function handleRegister(request, env) {
  const body = await readJson(request);

  if (!body) {
    return errorResponse("Body JSON tidak valid.");
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = body.password;

  if (!validEmail(email)) {
    return errorResponse("Email tidak valid.");
  }

  if (!validPassword(password)) {
    return errorResponse(
      "Password minimal 8 karakter."
    );
  }

  try {
    const existing = await env.DB
      .prepare(`
        SELECT id
        FROM users
        WHERE email = ?
        LIMIT 1
      `)
      .bind(email)
      .first();

    if (existing) {
      return errorResponse(
        "Email sudah terdaftar.",
        409
      );
    }

    const passwordHash = await hashPassword(password);

    const result = await env.DB
      .prepare(`
        INSERT INTO users (
          email,
          password_hash,
          coins
        )
        VALUES (?, ?, 0)
      `)
      .bind(
        email,
        passwordHash
      )
      .run();

    return json({
      ok: true,
      message: "Akun berhasil dibuat",
      user_id: result.meta.last_row_id
    }, 201);

  } catch (error) {
    return errorResponse(
      error?.message || "Gagal membuat akun.",
      500
    );
  }
}

async function handleLogin(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  const { success } = await env.LOGIN_LIMITER.limit({
    key: `login:${ip}`
  });

  if (!success) {
    return errorResponse(
      "Terlalu banyak percobaan login. Coba lagi nanti.",
      429
    );
  }

const body = await readJson(request);

if (!body) {
  return errorResponse("Body JSON tidak valid.");
}

const email = String(body.email || "").trim().toLowerCase();
const password = body.password;

if (!validEmail(email) || typeof password !== "string") {
  return errorResponse(
    "Email atau password tidak valid.",
    401
  );
}

  try {
    const user = await env.DB
      .prepare(`
        SELECT
          id,
          email,
          password_hash,
          coins
        FROM users
        WHERE email = ?
        LIMIT 1
      `)
      .bind(email)
      .first();

    if (!user) {
      return errorResponse(
        "Email atau password salah.",
        401
      );
    }

    const valid = await verifyPassword(
      password,
      user.password_hash
    );

    if (!valid) {
      return errorResponse(
        "Email atau password salah.",
        401
      );
    }

    const token = createToken();

    const expiresAt = new Date(
      Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    await env.DB
      .prepare(`
        INSERT INTO sessions (
          user_id,
          token,
          expires_at
        )
        VALUES (?, ?, ?)
      `)
      .bind(
        user.id,
        token,
        expiresAt
      )
      .run();

    return json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        coins: Number(user.coins)
      }
    }, 200, {
      "Set-Cookie": sessionCookie(token)
    });

  } catch (error) {
    return errorResponse(
      error?.message || "Login gagal.",
      500
    );
  }
}

async function handleLogout(request, env) {
  const token = getCookie(request, "session");

  if (token) {
    try {
      await env.DB
        .prepare(`
          DELETE FROM sessions
          WHERE token = ?
        `)
        .bind(token)
        .run();
    } catch {
      // Tetap hapus cookie walaupun session DB gagal dihapus.
    }
  }

  return json({
    ok: true,
    message: "Logout berhasil."
  }, 200, {
    "Set-Cookie": clearSessionCookie()
  });
}

async function handleMe(request, env) {
  const user = await getUser(request, env);

  if (!user) {
    return errorResponse(
      "Belum login.",
      401
    );
  }

  try {
    const address = await env.DB
      .prepare(`
        SELECT
          id,
          recipient_name,
          phone,
          address,
          city,
          province,
          postal_code,
          created_at,
          updated_at
        FROM user_addresses
        WHERE user_id = ?
        LIMIT 1
      `)
      .bind(user.id)
      .first();

    return json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        coins: Number(user.coins),
        address: address || null
      }
    });

  } catch (error) {
    return errorResponse(
      error?.message || "Gagal mengambil data profile.",
      500
    );
  }
}
async function handleBoxes(env) {
  try {
    const result = await env.DB
      .prepare(`
        SELECT
          id,
          name,
          description,
          price_coins,
          active,
          created_at
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
    return errorResponse(
      error?.message || "Gagal mengambil boxes.",
      500
    );
  }
}

async function handleBoxItems(request, env) {
  const url = new URL(request.url);
  const boxId = Number(url.searchParams.get("box_id"));

  if (!Number.isInteger(boxId) || boxId <= 0) {
    return errorResponse(
      "box_id tidak valid."
    );
  }

  try {
    const result = await env.DB
      .prepare(`
        SELECT
          id,
          box_id,
          name,
          image_url,
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
      items: (result.results || []).map(sanitizeItem)
    });

  } catch (error) {
    return errorResponse(
      error?.message || "Gagal mengambil items.",
      500
    );
  }
}

async function handleGacha(request, env) {
  const user = await getUser(request, env);

  if (!user) {
    return errorResponse(
      "Silakan login terlebih dahulu.",
      401
    );
  }

  const body = await readJson(request);

  if (!body) {
    return errorResponse(
      "Body JSON tidak valid."
    );
  }

  const boxId = Number(body.box_id);

  if (!Number.isInteger(boxId) || boxId <= 0) {
    return errorResponse(
      "box_id tidak valid."
    );
  }

  try {
    const box = await env.DB
      .prepare(`
        SELECT
          id,
          name,
          description,
          price_coins,
          active
        FROM gacha_boxes
        WHERE id = ?
          AND active = 1
        LIMIT 1
      `)
      .bind(boxId)
      .first();

    if (!box) {
      return errorResponse(
        "Box tidak ditemukan atau tidak aktif.",
        404
      );
    }

    const price = Number(box.price_coins);

    if (!Number.isFinite(price) || price < 0) {
      return errorResponse(
        "Harga box tidak valid.",
        500
      );
    }

    const currentCoins = Number(user.coins);

    if (!Number.isFinite(currentCoins)) {
      return errorResponse(
        "Saldo user tidak valid.",
        500
      );
    }

    if (currentCoins < price) {
      return errorResponse(
        "Coins tidak cukup.",
        400
      );
    }

    const itemsResult = await env.DB
      .prepare(`
        SELECT
          id,
          box_id,
          name,
          image_url,
          probability,
          stock,
          rarity
        FROM gacha_items
        WHERE box_id = ?
          AND stock > 0
        ORDER BY id ASC
      `)
      .bind(boxId)
      .all();

    const items = (itemsResult.results || [])
      .map(sanitizeItem);

    const selected = chooseWeightedItem(items);

    if (!selected) {
      return errorResponse(
        "Tidak ada item yang tersedia.",
        409
      );
    }

    const expectedCoins = currentCoins - price;
    const expectedStock = Number(selected.stock) - 1;

    /*
     * Semua perubahan penting dimasukkan ke D1 batch.
     *
     * Jika user tidak punya saldo yang cukup atau stock
     * sudah berubah karena request lain, inventory INSERT
     * sengaja gagal melalui nilai NULL pada kolom NOT NULL.
     *
     * Karena seluruh batch bersifat atomic, perubahan
     * sebelumnya akan dibatalkan.
     */

    const statements = [
      env.DB
        .prepare(`
          UPDATE users
          SET coins = coins - ?
          WHERE id = ?
            AND coins >= ?
        `)
        .bind(
          price,
          user.id,
          price
        ),

      env.DB
        .prepare(`
          UPDATE gacha_items
          SET stock = stock - 1
          WHERE id = ?
            AND box_id = ?
            AND stock > 0
        `)
        .bind(
          selected.id,
          boxId
        ),

      env.DB
        .prepare(`
          INSERT INTO inventory (
            user_id,
            item_id,
            status
          )
          SELECT
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM users
                WHERE id = ?
                  AND coins = ?
              )
              AND EXISTS (
                SELECT 1
                FROM gacha_items
                WHERE id = ?
                  AND box_id = ?
                  AND stock = ?
              )
              THEN ?
              ELSE NULL
            END,
            ?,
            'won'
        `)
        .bind(
          user.id,
          expectedCoins,
          selected.id,
          boxId,
          expectedStock,
          user.id,
          selected.id
        ),

      env.DB
        .prepare(`
          INSERT INTO coin_ledger (
            user_id,
            amount,
            type,
            description
          )
          VALUES (?, ?, ?, ?)
        `)
        .bind(
          user.id,
          -price,
          "gacha",
          `box:${boxId}:item:${selected.id}`
        )
    ];

    await env.DB.batch(statements);

    const newCoins = expectedCoins;

    return json({
      ok: true,
      message: "Gacha berhasil!",
      box: {
        id: box.id,
        name: box.name,
        description: box.description ?? null,
        price_coins: price,
        active: Number(box.active)
      },
     reward: {
  id: selected.id,
  box_id: selected.box_id,
  name: selected.name,
  image_url: selected.image_url ?? null,
  probability: Number(selected.probability),
  rarity: selected.rarity || "Common"
},
      user: {
        id: user.id,
        email: user.email,
        coins: newCoins
      }
    });

  } catch (error) {
    const message = error?.message || "Gacha gagal.";

    /*
     * Constraint error di sini biasanya berarti kondisi
     * berubah bersamaan dengan request lain. Karena batch
     * atomic, perubahan parsial tidak dibiarkan tersimpan.
     */
    if (
      message.includes("NOT NULL") ||
      message.includes("constraint") ||
      message.includes("CONSTRAINT")
    ) {
      return errorResponse(
        "Gacha gagal diproses. Saldo atau stock baru saja berubah. Silakan coba lagi.",
        409
      );
    }

    return errorResponse(
      message,
      500
    );
  }
}

async function handleInventory(request, env) {
  const user = await getUser(request, env);

  if (!user) {
    return errorResponse(
      "Silakan login terlebih dahulu.",
      401
    );
  }

  try {
    const result = await env.DB
      .prepare(`
        SELECT
          i.id,
          i.status,
          i.created_at,
          g.id AS item_id,
          g.box_id,
          g.name,
          g.image_url,
          g.probability,
          g.rarity
        FROM inventory i
        JOIN gacha_items g
          ON g.id = i.item_id
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
    return errorResponse(
      error?.message || "Gagal mengambil inventory.",
      500
    );
  }
}
```js
async function handleAddress(request, env) {
  const user = await getUser(request, env);

  if (!user) {
    return errorResponse(
      "Silakan login terlebih dahulu.",
      401
    );
  }

  const body = await readJson(request);

  if (!body) {
    return errorResponse(
      "Body JSON tidak valid."
    );
  }

  const recipientName = String(body.recipient_name || "").trim();
  const phone = String(body.phone || "").trim();
  const address = String(body.address || "").trim();
  const city = String(body.city || "").trim();
  const province = String(body.province || "").trim();
  const postalCode = String(body.postal_code || "").trim();

  if (
    !recipientName ||
    !phone ||
    !address ||
    !city ||
    !province ||
    !postalCode
  ) {
    return errorResponse(
      "Semua data alamat wajib diisi."
    );
  }

  try {
    await env.DB
      .prepare(`
        INSERT INTO user_addresses (
          user_id,
          recipient_name,
          phone,
          address,
          city,
          province,
          postal_code
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id)
        DO UPDATE SET
          recipient_name = excluded.recipient_name,
          phone = excluded.phone,
          address = excluded.address,
          city = excluded.city,
          province = excluded.province,
          postal_code = excluded.postal_code,
          updated_at = CURRENT_TIMESTAMP
      `)
      .bind(
        user.id,
        recipientName,
        phone,
        address,
        city,
        province,
        postalCode
      )
      .run();

    const savedAddress = await env.DB
      .prepare(`
        SELECT
          id,
          recipient_name,
          phone,
          address,
          city,
          province,
          postal_code,
          created_at,
          updated_at
        FROM user_addresses
        WHERE user_id = ?
        LIMIT 1
      `)
      .bind(user.id)
      .first();

    return json({
      ok: true,
      message: "Alamat berhasil disimpan.",
      address: savedAddress
    });

  } catch (error) {
    return errorResponse(
      error?.message || "Gagal menyimpan alamat.",
      500
    );
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/health") {
    return handleHealth(env);
  }

  if (request.method === "POST" && path === "/api/register") {
    return handleRegister(request, env);
  }

  if (request.method === "POST" && path === "/api/login") {
    return handleLogin(request, env);
  }

  if (request.method === "POST" && path === "/api/logout") {
    return handleLogout(request, env);
  }

  if (request.method === "GET" && path === "/api/me") {
    return handleMe(request, env);
  }

  if (request.method === "PUT" && path === "/api/address") {
    return handleAddress(request, env);
  }

  if (request.method === "GET" && path === "/api/boxes") {
    return handleBoxes(env);
  }

  if (request.method === "GET" && path === "/api/box-items") {
    return handleBoxItems(request, env);
  }

  if (request.method === "POST" && path === "/api/gacha") {
    return handleGacha(request, env);
  }

  if (request.method === "GET" && path === "/api/inventory") {
    return handleInventory(request, env);
  }

  return null;
}
'''

export default {
  async fetch(request, env) {
    try {
      const apiResponse = await handleRequest(request, env);

      if (apiResponse) {
        return apiResponse;
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response(
        "KuroBox is running.",
        {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8"
          }
        }
      );

    } catch (error) {
      console.error("KuroBox error:", error);

      return json({
        ok: false,
        error: error?.message || "Internal Server Error"
      }, 500);
    }
  }
};
