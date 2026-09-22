/* Uji akhir: dlink foto + penandaan tanda tangan randsk klasik */
const axios = require("axios");
const crypto = require("crypto");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SURL = "Ow1yytRuOq9Fev1kAZmj1A";
const HOST = "https://www.terabox.app";

(async () => {
  const jar = {};
  const page = await axios.get(`${HOST}/sharing/link?surl=${SURL}`, { headers: { "User-Agent": UA, Accept: "text/html" } });
  (page.headers["set-cookie"] || []).forEach((c) => { const [kv] = c.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); });
  const cookieStr = Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ");
  const H = { "User-Agent": UA, Referer: `${HOST}/sharing/link?surl=${SURL}`, Cookie: cookieStr, Accept: "application/json, text/plain, */*" };
  const common = { app_id: "250528", web: "1", channel: "dubox", clienttype: "0", jsToken: "", lang: "en_us" };

  const info = (await axios.get(`${HOST}/api/shorturlinfo`, { params: { ...common, shorturl: "1" + SURL, root: 1, scene: "" }, headers: H })).data;
  const rootPath = info.list[0].path; // /UPLOAD TELE/X/SHERINA
  const auth = { uk: info.uk_str, shareid: info.shareid, sign: info.sign, timestamp: info.timestamp, shorturl: SURL };

  // foto-foto di PICT
  const pict = (await axios.get(`${HOST}/share/list`, { params: { ...common, ...auth, dir: rootPath + "/PICT", page: 1, num: 100, order: "name", desc: 0, category: 0 }, headers: H })).data;
  const photos = (pict.list || []).filter((f) => !Number(f.isdir));
  console.log("photos:", photos.length);
  const first = photos[0];
  console.log("sample photo keys:", Object.keys(first).join(","));
  console.log("sample thumbs:", JSON.stringify(first.thumbs || first.thumbnail || first.icons || "").slice(0, 200));
  console.log("sample dlink:", JSON.stringify(first.dlink || "").slice(0, 200));

  // minta dlink untuk 3 foto via share/download
  const fids = photos.slice(0, 3).map((f) => f.fs_id);
  const dl = (await axios.get(`${HOST}/share/download`, { params: { ...common, ...auth, fid_list: JSON.stringify(fids), product: "share", primaryid: info.shareid, dl: 0, version: "2", scene: "" }, headers: H })).data;
  console.log("\nshare/download errno:", dl.errno, "keys:", Object.keys(dl).join(","));
  const link0 = dl.links && dl.links[0];
  console.log("link0:", JSON.stringify(link0).slice(0, 260));

  if (link0 && link0.dlink) {
    const ts = Math.floor(Date.now() / 1000);
    const randsk = decodeURIComponent(jar.NDUSSR || jar.randsk || info.randsk || "");
    console.log("randsk len:", randsk.length);
    const signFull = crypto.createHash("md5").update(randsk + ":" + ts).digest("hex");
    const sign = signFull.slice(10, 20);
    const sep = link0.dlink.includes("?") ? "&" : "?";
    const url = `${link0.dlink}${sep}uk=${auth.uk}&primaryid=${auth.shareid}&fid_list=${fids.slice(0, 3).join(",")}&product=share&sign=${sign}&timestamp=${ts}&app_id=250528&channel=dubox&clienttype=0&type=dlink&is_from=web`;
    const r = await axios.get(url, { headers: { "User-Agent": UA, Cookie: cookieStr, Referer: HOST + "/" }, responseType: "stream", timeout: 20000, maxRedirects: 3 });
    console.log("GET signed dlink:", r.status, r.headers["content-type"], r.headers["content-disposition"] || "");
    let got = 0;
    r.data.on("data", (c) => { got += c.length; if (got > 4096) r.data.destroy(); });
    await new Promise((res) => r.data.on("close", res).on("end", res));
    console.log("bytes preview:", got);
  }
})().catch((e) => console.log("ERR", e.response ? e.response.status + " " + JSON.stringify(e.response.data).slice(0, 250) : e.message));
