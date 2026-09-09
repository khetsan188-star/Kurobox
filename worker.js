export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        app: "KuroBox",
        version: "v6",
        database: Boolean(env.DB)
      });
    }

    if (url.pathname === "/api/gacha") {
      if (request.method !== "POST") {
        return Response.json({error:"Method not allowed"}, {status:405});
      }
      return Response.json({
        ok:false,
        message:"Gacha API is intentionally disabled until D1 and production rules are configured."
      }, {status:503});
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("KuroBox is running.", {headers:{"content-type":"text/plain"}});
  }
};
