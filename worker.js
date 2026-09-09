export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Cek Worker + D1
    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        app: "KuroBox",
        version: "v7",
        database: Boolean(env.DB)
      });
    }

    // Ambil daftar box dari D1
    if (url.pathname === "/api/boxes") {
      if (!env.DB) {
        return Response.json(
          { ok: false, error: "D1 database belum terhubung" },
          { status: 500 }
        );
      }

      try {
        const result = await env.DB
          .prepare(`
            SELECT
              id,
              name,
              description,
              price_coins,
              active
            FROM gacha_boxes
            WHERE active = 1
            ORDER BY id ASC
          `)
          .all();

        return Response.json({
          ok: true,
          boxes: result.results || []
        });
      } catch (error) {
        return Response.json({
          ok: false,
          error: error.message
        }, { status: 500 });
      }
    }

    // Ambil hadiah dari sebuah box
    if (url.pathname === "/api/box-items") {
      const boxId = url.searchParams.get("box_id");

      if (!boxId) {
        return Response.json(
          { ok: false, error: "box_id wajib diisi" },
          { status: 400 }
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

        return Response.json({
          ok: true,
          items: result.results || []
        });
      } catch (error) {
        return Response.json({
          ok: false,
          error: error.message
        }, { status: 500 });
      }
    }

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
