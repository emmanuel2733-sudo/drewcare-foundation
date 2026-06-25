const http = require("http");
const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
loadEnv(path.join(rootDir, ".env"));

const PORT = Number(process.env.PORT || 3000);
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const DONATION_CURRENCY = process.env.DONATION_CURRENCY || "NGN";

const staticFiles = {
  "/": "DREWCARE FOUNDATION.html",
  "/index.html": "DREWCARE FOUNDATION.html",
  "/donation-success.html": "donation-success.html"
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, SITE_URL);

    if (req.method === "POST" && url.pathname === "/api/donations/initialize") {
      await initializeDonation(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/donations/verify") {
      await verifyDonation(url.searchParams.get("reference"), res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    const fileName = staticFiles[url.pathname] || decodeURIComponent(url.pathname.slice(1));
    const filePath = path.resolve(rootDir, fileName);

    if (path.relative(rootDir, filePath).startsWith("..")) {
      sendText(res, 403, "Forbidden");
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error." });
  }
});

server.listen(PORT, () => {
  console.log(`DrewCare Foundation site running at ${SITE_URL}`);
  if (!PAYSTACK_SECRET_KEY) {
    console.log("Paystack donations need PAYSTACK_SECRET_KEY in .env before real checkout will work.");
  }
});

async function initializeDonation(req, res) {
  if (!PAYSTACK_SECRET_KEY) {
    sendJson(res, 500, { error: "PAYSTACK_SECRET_KEY is not configured." });
    return;
  }

  const body = await readJson(req);
  const amount = Number(body.amount);
  const email = String(body.email || "").trim();
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const campaign = String(body.campaign || "General Donation").trim();

  if (!Number.isFinite(amount) || amount < 100) {
    sendJson(res, 400, { error: "Donation amount must be at least NGN 100." });
    return;
  }

  if (!email || !email.includes("@")) {
    sendJson(res, 400, { error: "A valid donor email is required." });
    return;
  }

  if (!name) {
    sendJson(res, 400, { error: "Donor name is required." });
    return;
  }

  const payload = {
    email,
    amount: Math.round(amount * 100),
    currency: DONATION_CURRENCY,
    callback_url: `${SITE_URL}/donation-success.html`,
    metadata: {
      donor_name: name,
      phone,
      campaign,
      custom_fields: [
        {
          display_name: "Donor Name",
          variable_name: "donor_name",
          value: name
        },
        {
          display_name: "Donation Focus",
          variable_name: "campaign",
          value: campaign
        }
      ]
    }
  };

  const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const paystackPayload = await paystackResponse.json();

  if (!paystackResponse.ok || !paystackPayload.status) {
    sendJson(res, 502, { error: paystackPayload.message || "Paystack could not initialize this donation." });
    return;
  }

  sendJson(res, 200, {
    authorizationUrl: paystackPayload.data.authorization_url,
    accessCode: paystackPayload.data.access_code,
    reference: paystackPayload.data.reference
  });
}

async function verifyDonation(reference, res) {
  if (!PAYSTACK_SECRET_KEY) {
    sendJson(res, 500, { error: "PAYSTACK_SECRET_KEY is not configured." });
    return;
  }

  if (!reference) {
    sendJson(res, 400, { error: "Missing payment reference." });
    return;
  }

  const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
    }
  });

  const paystackPayload = await paystackResponse.json();

  if (!paystackResponse.ok || !paystackPayload.status) {
    sendJson(res, 502, { error: paystackPayload.message || "Unable to verify this donation." });
    return;
  }

  const data = paystackPayload.data;
  sendJson(res, 200, {
    status: data.status,
    reference: data.reference,
    amount: data.amount / 100,
    currency: data.currency,
    paidAt: data.paid_at,
    channel: data.channel,
    campaign: data.metadata?.campaign || "General Donation",
    donorName: data.metadata?.donor_name || ""
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;

      if (raw.length > 100000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
