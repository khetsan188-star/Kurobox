# KuroBox V5 — Gacha Business Full-Stack Starter

KuroBox tetap menggunakan konsep gacha, tetapi hasil gacha diputuskan server dan data utama disimpan di Cloudflare D1, bukan di browser.

## Fitur backend
- Register/login dengan password hash + session token
- Saldo koin tersimpan di database
- Box + hadiah + probabilitas + stok dari database
- Gacha server-side dengan weighted random
- Pengurangan koin dilakukan di server
- Pengurangan stok dilakukan di server
- Inventory dan riwayat gacha tersimpan
- Coin ledger
- Permintaan top-up dan persetujuan admin
- Endpoint statistik admin

## Deploy ke Cloudflare
Cloudflare Workers dapat menyajikan static assets dan API dari Worker yang sama. D1 dapat di-bind ke Worker melalui binding `DB`.

1. Buat D1 Database bernama `kurobox-db` di Cloudflare.
2. Copy **Database ID** ke `wrangler.jsonc`, menggantikan `GANTI_DENGAN_DATABASE_ID`.
3. Jalankan schema:
   `npx wrangler d1 execute kurobox-db --remote --file=./migrations/0001_init.sql`
4. Jalankan seed:
   `npx wrangler d1 execute kurobox-db --remote --file=./seed.sql`
5. Set secret admin:
   `npx wrangler secret put ADMIN_KEY`
6. Deploy:
   `npx wrangler deploy`

## Penting sebelum menerima uang asli
Endpoint `/api/topup/request` sengaja belum mengklaim pembayaran sukses. Hubungkan ke payment gateway/PJP QRIS yang kamu pilih dan gunakan webhook server-to-server untuk konfirmasi pembayaran. Jangan menambah koin hanya berdasarkan data dari browser.

Gacha berbayar juga perlu ditinjau dari sisi hukum/regulasi, syarat layanan, perlindungan konsumen, aturan platform, dan PSE sebelum diluncurkan.

## API ringkas
- GET `/api/health`
- GET `/api/boxes`
- POST `/api/auth/register`
- POST `/api/auth/login`
- GET `/api/me`
- POST `/api/gacha`
- GET `/api/inventory`
- POST `/api/topup/request`
- GET `/api/admin/stats` (X-Admin-Key)
- POST `/api/admin/approve-topup` (X-Admin-Key)
